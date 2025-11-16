from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime, timezone
import pypdf
import io
import re
from pinecone import Pinecone, ServerlessSpec
import google.generativeai as genai

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Initialize Pinecone
pc = Pinecone(api_key=os.environ['PINECONE_API_KEY'])
index_name = "health-insurance-rag"

# Check if index exists, if not create it
if index_name not in pc.list_indexes().names():
    pc.create_index(
        name=index_name,
        dimension=768,  # Gemini embedding dimension
        metric='cosine',
        spec=ServerlessSpec(
            cloud='aws',
            region='us-east-1'
        )
    )

index = pc.Index(index_name)

# Initialize Gemini
genai.configure(api_key=os.environ['GEMINI_API_KEY'])

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Define Models
class Document(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    upload_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    num_pages: int
    status: str = "processing"  # processing, completed, failed
    chunks_count: int = 0

class QueryRequest(BaseModel):
    question: str
    top_k: int = 5

class Citation(BaseModel):
    page_number: int
    chunk_id: str
    text_snippet: str
    relevance_score: float

class QueryResponse(BaseModel):
    answer: str
    citations: List[Citation]
    has_grounded_answer: bool
    structured_sections: Optional[Dict[str, str]] = None

def extract_text_from_pdf(pdf_file: bytes) -> tuple[str, int]:
    """Extract text from PDF file"""
    pdf_reader = pypdf.PdfReader(io.BytesIO(pdf_file))
    num_pages = len(pdf_reader.pages)
    
    text_by_page = {}
    for page_num, page in enumerate(pdf_reader.pages, 1):
        text = page.extract_text()
        text_by_page[page_num] = text
    
    return text_by_page, num_pages

def semantic_chunk_text(text_by_page: Dict[int, str], chunk_size: int = 1000, overlap: int = 200) -> List[Dict[str, Any]]:
    """Chunk text semantically with overlap"""
    chunks = []
    
    for page_num, text in text_by_page.items():
        # Split by paragraphs first
        paragraphs = re.split(r'\n\s*\n', text)
        
        current_chunk = ""
        for para in paragraphs:
            if len(current_chunk) + len(para) < chunk_size:
                current_chunk += para + "\n\n"
            else:
                if current_chunk.strip():
                    chunks.append({
                        "text": current_chunk.strip(),
                        "page_number": page_num,
                        "chunk_id": str(uuid.uuid4())
                    })
                current_chunk = para + "\n\n"
        
        # Add remaining chunk
        if current_chunk.strip():
            chunks.append({
                "text": current_chunk.strip(),
                "page_number": page_num,
                "chunk_id": str(uuid.uuid4())
            })
    
    return chunks

def get_embedding(text: str) -> List[float]:
    """Generate embedding using Gemini"""
    result = genai.embed_content(
        model="models/embedding-001",
        content=text,
        task_type="retrieval_document"
    )
    return result['embedding']

def get_query_embedding(text: str) -> List[float]:
    """Generate embedding for query using Gemini"""
    result = genai.embed_content(
        model="models/embedding-001",
        content=text,
        task_type="retrieval_query"
    )
    return result['embedding']

async def generate_answer(question: str, context_chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate answer using Gemini with safety prompts"""
    
    # Build context from retrieved chunks
    context = "\n\n".join([
        f"[Page {chunk['page_number']}, Chunk ID: {chunk['chunk_id']}]\n{chunk['text']}"
        for chunk in context_chunks
    ])
    
    # Safety and grounding prompt
    prompt = f"""You are a health insurance policy assistant. Your task is to answer questions based ONLY on the provided policy document excerpts.

IMPORTANT INSTRUCTIONS:
1. Answer ONLY based on the information in the context below
2. If the answer is not in the context, say "The policy document does not contain information about this. Please refer to the complete policy or contact customer service."
3. Always cite the page number and chunk ID for your answer
4. Provide structured, clear answers
5. Do not make assumptions or add information not present in the context

CONTEXT FROM POLICY DOCUMENTS:
{context}

QUESTION: {question}

ANSWER (with citations):"""
    
    model = genai.GenerativeModel('gemini-2.0-flash')
    response = model.generate_content(prompt)
    
    # Check if answer is grounded
    has_grounded_answer = "does not contain information" not in response.text.lower()
    
    return {
        "answer": response.text,
        "has_grounded_answer": has_grounded_answer
    }

@api_router.post("/upload")
async def upload_documents(files: List[UploadFile] = File(...)):
    """Upload and process PDF documents"""
    try:
        processed_docs = []
        
        for file in files:
            if not file.filename.endswith('.pdf'):
                continue
            
            # Read PDF
            pdf_content = await file.read()
            
            # Extract text
            text_by_page, num_pages = extract_text_from_pdf(pdf_content)
            
            # Create document record
            doc_id = str(uuid.uuid4())
            doc = Document(
                id=doc_id,
                filename=file.filename,
                num_pages=num_pages,
                status="processing"
            )
            
            # Chunk text
            chunks = semantic_chunk_text(text_by_page)
            
            # Generate embeddings and store in Pinecone
            vectors_to_upsert = []
            for chunk in chunks:
                embedding = get_embedding(chunk["text"])
                vectors_to_upsert.append({
                    "id": chunk["chunk_id"],
                    "values": embedding,
                    "metadata": {
                        "document_id": doc_id,
                        "filename": file.filename,
                        "page_number": chunk["page_number"],
                        "text": chunk["text"][:1000]  # Store first 1000 chars in metadata
                    }
                })
            
            # Batch upsert to Pinecone
            if vectors_to_upsert:
                index.upsert(vectors=vectors_to_upsert)
            
            # Update document status
            doc.status = "completed"
            doc.chunks_count = len(chunks)
            
            # Save to MongoDB
            doc_dict = doc.model_dump()
            doc_dict['upload_date'] = doc_dict['upload_date'].isoformat()
            await db.documents.insert_one(doc_dict)
            
            processed_docs.append(doc)
        
        return {
            "message": f"Successfully processed {len(processed_docs)} documents",
            "documents": [doc.model_dump() for doc in processed_docs]
        }
    
    except Exception as e:
        logging.error(f"Error processing documents: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/query", response_model=QueryResponse)
async def query_documents(query: QueryRequest):
    """Query the RAG system"""
    try:
        # Generate query embedding
        query_embedding = get_query_embedding(query.question)
        
        # Search in Pinecone
        search_results = index.query(
            vector=query_embedding,
            top_k=query.top_k,
            include_metadata=True
        )
        
        # Extract chunks from results
        context_chunks = []
        citations = []
        
        for match in search_results['matches']:
            chunk_data = {
                "text": match['metadata']['text'],
                "page_number": match['metadata']['page_number'],
                "chunk_id": match['id']
            }
            context_chunks.append(chunk_data)
            
            citations.append(Citation(
                page_number=match['metadata']['page_number'],
                chunk_id=match['id'],
                text_snippet=match['metadata']['text'][:200] + "...",
                relevance_score=match['score']
            ))
        
        # Generate answer using Gemini
        answer_data = await generate_answer(query.question, context_chunks)
        
        return QueryResponse(
            answer=answer_data["answer"],
            citations=citations,
            has_grounded_answer=answer_data["has_grounded_answer"]
        )
    
    except Exception as e:
        logging.error(f"Error querying documents: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/documents", response_model=List[Document])
async def get_documents():
    """Get all uploaded documents"""
    documents = await db.documents.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps back to datetime objects
    for doc in documents:
        if isinstance(doc['upload_date'], str):
            doc['upload_date'] = datetime.fromisoformat(doc['upload_date'])
    
    return documents

@api_router.delete("/documents")
async def delete_all_documents():
    """Delete all documents and clear vector database"""
    try:
        # Delete from Pinecone
        index.delete(delete_all=True)
        
        # Delete from MongoDB
        result = await db.documents.delete_many({})
        
        return {
            "message": f"Deleted {result.deleted_count} documents from database and cleared vector store"
        }
    except Exception as e:
        logging.error(f"Error deleting documents: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/")
async def root():
    return {"message": "Health Insurance RAG API is running"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()