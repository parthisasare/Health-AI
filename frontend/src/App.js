import { useState, useEffect, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { FileText, Upload, MessageCircle, Trash2, Send, AlertCircle, CheckCircle2, BookOpen, FileCheck } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("upload");
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const fetchDocuments = async () => {
    try {
      const response = await axios.get(`${API}/documents`);
      setDocuments(response.data);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error("Failed to fetch documents");
    }
  };

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles(files);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Please select at least one PDF file");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      const response = await axios.post(`${API}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      toast.success(`Successfully uploaded ${response.data.documents.length} document(s)`);
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      fetchDocuments();
      
      setTimeout(() => {
        setActiveTab("chat");
      }, 1000);
    } catch (error) {
      console.error("Error uploading documents:", error);
      toast.error("Failed to upload documents");
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 2000);
    }
  };

  const handleQuery = async () => {
    if (!question.trim()) {
      toast.error("Please enter a question");
      return;
    }

    if (documents.length === 0) {
      toast.error("Please upload documents first");
      return;
    }

    setLoading(true);
    
    const userMessage = {
      type: "user",
      content: question,
      timestamp: new Date().toISOString()
    };
    
    setChatHistory(prev => [...prev, userMessage]);
    setQuestion("");

    try {
      const response = await axios.post(`${API}/query`, {
        question: question,
        top_k: 5
      });

      const assistantMessage = {
        type: "assistant",
        content: response.data.answer,
        citations: response.data.citations,
        has_grounded_answer: response.data.has_grounded_answer,
        timestamp: new Date().toISOString()
      };

      setChatHistory(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error querying documents:", error);
      toast.error("Failed to get answer");
      
      const errorMessage = {
        type: "assistant",
        content: "Sorry, I encountered an error processing your question. Please try again.",
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm("Are you sure you want to delete all documents?")) {
      return;
    }

    try {
      await axios.delete(`${API}/documents`);
      toast.success("All documents deleted");
      setDocuments([]);
      setChatHistory([]);
      setActiveTab("upload");
    } catch (error) {
      console.error("Error deleting documents:", error);
      toast.error("Failed to delete documents");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuery();
    }
  };

  return (
    <div className="app-container">
      <div className="hero-section">
        <div className="hero-content">
          <div className="hero-icon">
            <BookOpen className="w-16 h-16" />
          </div>
          <h1 className="hero-title">Health Insurance Policy Assistant</h1>
          <p className="hero-subtitle">
            Upload your health insurance policy documents and ask questions in natural language.
            Get instant answers with citations from your policy.
          </p>
        </div>
      </div>

      <div className="main-content">
        <div className="container">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="tabs-container">
            <TabsList className="tabs-list">
              <TabsTrigger value="upload" className="tab-trigger" data-testid="upload-tab">
                <Upload className="w-4 h-4 mr-2" />
                Upload Documents
              </TabsTrigger>
              <TabsTrigger value="chat" className="tab-trigger" data-testid="chat-tab">
                <MessageCircle className="w-4 h-4 mr-2" />
                Ask Questions
              </TabsTrigger>
              <TabsTrigger value="documents" className="tab-trigger" data-testid="documents-tab">
                <FileText className="w-4 h-4 mr-2" />
                My Documents ({documents.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="tab-content">
              <Card className="upload-card">
                <CardHeader>
                  <CardTitle className="card-title">
                    <FileCheck className="w-6 h-6 mr-2" />
                    Upload Policy Documents
                  </CardTitle>
                  <CardDescription className="card-description">
                    Upload one or more PDF files containing your health insurance policy documents.
                    Our system will process and index them for intelligent question answering.
                  </CardDescription>
                </CardHeader>
                <CardContent className="card-content">
                  <div className="upload-area">
                    <div className="file-input-wrapper">
                      <Input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        multiple
                        onChange={handleFileSelect}
                        className="file-input"
                        data-testid="file-input"
                      />
                      {selectedFiles.length > 0 && (
                        <div className="selected-files" data-testid="selected-files">
                          <p className="selected-files-label">Selected files:</p>
                          {selectedFiles.map((file, idx) => (
                            <Badge key={idx} variant="secondary" className="file-badge">
                              <FileText className="w-3 h-3 mr-1" />
                              {file.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {uploadProgress > 0 && (
                      <div className="progress-wrapper">
                        <Progress value={uploadProgress} className="progress-bar" />
                        <p className="progress-text">{uploadProgress}%</p>
                      </div>
                    )}

                    <Button
                      onClick={handleUpload}
                      disabled={uploading || selectedFiles.length === 0}
                      className="upload-button"
                      data-testid="upload-button"
                    >
                      {uploading ? (
                        <>
                          <div className="spinner" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload & Process
                        </>
                      )}
                    </Button>
                  </div>

                  <Alert className="info-alert">
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      Documents will be processed using semantic chunking and stored securely.
                      This may take a few moments depending on document size.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="chat" className="tab-content">
              <Card className="chat-card">
                <CardHeader>
                  <CardTitle className="card-title">
                    <MessageCircle className="w-6 h-6 mr-2" />
                    Ask About Your Policy
                  </CardTitle>
                  <CardDescription className="card-description">
                    Ask questions about coverage, exclusions, waiting periods, and more.
                  </CardDescription>
                </CardHeader>
                <CardContent className="chat-content">
                  <ScrollArea className="chat-history" data-testid="chat-history">
                    {chatHistory.length === 0 ? (
                      <div className="empty-chat">
                        <MessageCircle className="empty-icon" />
                        <p className="empty-text">Start by asking a question about your policy</p>
                        <div className="sample-questions">
                          <p className="sample-label">Sample questions:</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="sample-button"
                            onClick={() => setQuestion("What illnesses are excluded from OPD coverage?")}
                            data-testid="sample-question-1"
                          >
                            What illnesses are excluded from OPD coverage?
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="sample-button"
                            onClick={() => setQuestion("Is maternity covered? If yes, after what waiting period?")}
                            data-testid="sample-question-2"
                          >
                            Is maternity covered?
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="sample-button"
                            onClick={() => setQuestion("What is the maximum no-claim bonus?")}
                            data-testid="sample-question-3"
                          >
                            What is the maximum no-claim bonus?
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="messages">
                        {chatHistory.map((msg, idx) => (
                          <div key={idx} className={`message message-${msg.type}`} data-testid={`message-${msg.type}`}>
                            <div className="message-content">
                              <p className="message-text">{msg.content}</p>
                              
                              {msg.citations && msg.citations.length > 0 && (
                                <div className="citations" data-testid="citations">
                                  <Separator className="my-3" />
                                  <p className="citations-label">Citations:</p>
                                  {msg.citations.map((citation, cidx) => (
                                    <div key={cidx} className="citation-item">
                                      <Badge variant="outline" className="citation-badge">
                                        Page {citation.page_number}
                                      </Badge>
                                      <p className="citation-text">{citation.text_snippet}</p>
                                      <p className="citation-score">Relevance: {(citation.relevance_score * 100).toFixed(1)}%</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                              {msg.has_grounded_answer !== undefined && (
                                <div className="grounding-indicator">
                                  {msg.has_grounded_answer ? (
                                    <Badge variant="default" className="grounded-badge">
                                      <CheckCircle2 className="w-3 h-3 mr-1" />
                                      Grounded in Policy
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="not-grounded-badge">
                                      <AlertCircle className="w-3 h-3 mr-1" />
                                      Limited Information
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </ScrollArea>

                  <div className="input-area">
                    <Input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Ask about your insurance policy..."
                      disabled={loading || documents.length === 0}
                      className="question-input"
                      data-testid="question-input"
                    />
                    <Button
                      onClick={handleQuery}
                      disabled={loading || !question.trim() || documents.length === 0}
                      className="send-button"
                      data-testid="send-button"
                    >
                      {loading ? (
                        <div className="spinner" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  </div>

                  {documents.length === 0 && (
                    <Alert className="warning-alert">
                      <AlertCircle className="w-4 h-4" />
                      <AlertDescription>
                        Please upload policy documents first before asking questions.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="tab-content">
              <Card className="documents-card">
                <CardHeader>
                  <div className="documents-header">
                    <div>
                      <CardTitle className="card-title">
                        <FileText className="w-6 h-6 mr-2" />
                        Uploaded Documents
                      </CardTitle>
                      <CardDescription className="card-description">
                        Manage your uploaded policy documents
                      </CardDescription>
                    </div>
                    {documents.length > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteAll}
                        className="delete-all-button"
                        data-testid="delete-all-button"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete All
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="documents-content">
                  {documents.length === 0 ? (
                    <div className="empty-documents">
                      <FileText className="empty-icon" />
                      <p className="empty-text">No documents uploaded yet</p>
                      <Button
                        variant="outline"
                        onClick={() => setActiveTab("upload")}
                        className="upload-first-button"
                        data-testid="upload-first-button"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Your First Document
                      </Button>
                    </div>
                  ) : (
                    <div className="documents-list">
                      {documents.map((doc, idx) => (
                        <Card key={idx} className="document-card" data-testid="document-card">
                          <CardContent className="document-content">
                            <div className="document-icon">
                              <FileText className="w-8 h-8" />
                            </div>
                            <div className="document-info">
                              <h3 className="document-title">{doc.filename}</h3>
                              <div className="document-meta">
                                <Badge variant="secondary" className="meta-badge">
                                  {doc.num_pages} pages
                                </Badge>
                                <Badge variant="secondary" className="meta-badge">
                                  {doc.chunks_count} chunks
                                </Badge>
                                <Badge
                                  variant={doc.status === "completed" ? "default" : "secondary"}
                                  className="status-badge"
                                >
                                  {doc.status === "completed" ? (
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                  ) : null}
                                  {doc.status}
                                </Badge>
                              </div>
                              <p className="document-date">
                                Uploaded: {new Date(doc.upload_date).toLocaleString()}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default App;