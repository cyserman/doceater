
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeDocumentBoundaries } from './geminiService';
import { ExtractedDocument } from './types';

// Declare external globals
declare const PDFLib: any;
declare const pdfjsLib: any;
declare const JSZip: any;
declare const gapi: any;
declare const google: any;

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

const App: React.FC = () => {
  // Core State
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [scansFile, setScansFile] = useState<File | null>(null);
  const [contextHint, setContextHint] = useState('General Document Bundle');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<'idle' | 'auth' | 'uploading' | 'success'>('idle');
  
  // Undo/Redo History
  const [history, setHistory] = useState<ExtractedDocument[][]>([]);
  const [redoStack, setRedoStack] = useState<ExtractedDocument[][]>([]);
  
  // Work-in-Progress Step
  const [workflowStep, setWorkflowStep] = useState<'upload' | 'review' | 'finalized'>('upload');

  // Persistence: Load on mount
  useEffect(() => {
    const saved = localStorage.getItem('doc_intelligence_wip');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.documents && parsed.documents.length > 0) {
          const docs = parsed.documents.map((d: any) => ({ ...d, blob: undefined, status: 'pending' }));
          setDocuments(docs);
          setWorkflowStep('review');
          if (parsed.contextHint) setContextHint(parsed.contextHint);
        }
      } catch (e) {
        console.error("Failed to restore session", e);
      }
    }
  }, []);

  // Persistence: Save on change (Metadata only)
  useEffect(() => {
    if (documents.length > 0) {
      const dataToSave = documents.map(({ blob, ...rest }) => rest);
      localStorage.setItem('doc_intelligence_wip', JSON.stringify({ documents: dataToSave, contextHint }));
    } else {
      localStorage.removeItem('doc_intelligence_wip');
    }
  }, [documents, contextHint]);

  const pushToHistory = useCallback((newDocs: ExtractedDocument[]) => {
    setHistory(prev => [...prev, documents]);
    setRedoStack([]);
    setDocuments(newDocs);
  }, [documents]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack(prev => [...prev, documents]);
    setHistory(prev => prev.slice(0, -1));
    setDocuments(previous);
  }, [history, documents]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, documents]);
    setRedoStack(prev => prev.slice(0, -1));
    setDocuments(next);
  }, [redoStack, documents]);

  // Keyboard Shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    const initGapi = async () => {
      await new Promise((resolve) => gapi.load('client', resolve));
      await gapi.client.init({
        apiKey: process.env.API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
      });
    };
    if (typeof gapi !== 'undefined') initGapi();
  }, []);

  const calculateSHA256 = async (buffer: ArrayBuffer): Promise<string> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const getCategoryColor = (category: string) => {
    const colors = [
      'bg-blue-600', 'bg-emerald-600', 'bg-rose-600', 'bg-amber-600', 
      'bg-purple-600', 'bg-indigo-600', 'bg-cyan-600', 'bg-pink-600'
    ];
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = category.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const extractTextFromPDF = async (file: File): Promise<string[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      pageTexts.push(pageText);
      setProgress(`Analyzing Content: ${i}/${pdf.numPages}`);
    }
    return pageTexts;
  };

  const startAnalysis = async () => {
    if (!ocrFile) return;
    setIsProcessing(true);
    setError(null);
    try {
      const pageTexts = await extractTextFromPDF(ocrFile);
      setProgress("Intelligence engine identifying boundaries...");
      const boundaries = await analyzeDocumentBoundaries(pageTexts, contextHint);
      
      const initialDocs: ExtractedDocument[] = boundaries.map(b => ({
        id: Math.random().toString(36).substr(2, 9),
        title: b.title || 'Untitled',
        description: b.description || 'No description',
        category: b.category || 'Uncategorized',
        startPage: b.startPage || 0,
        endPage: b.endPage || 0,
        tags: [],
        notes: '',
        status: 'pending',
        selected: false
      }));
      setDocuments(initialDocs);
      setWorkflowStep('review');
    } catch (err: any) {
      setError(err.message || "AI Analysis failed. Check your API key.");
    } finally {
      setIsProcessing(false);
    }
  };

  const finalizeSplit = async () => {
    if (!scansFile) {
      setError("Please upload the High-Resolution Master PDF to finalize.");
      return;
    }
    setIsProcessing(true);
    setError(null);
    setProgress("Initializing secure binary segments...");
    try {
      const arrayBuffer = await scansFile.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
      
      const newDocs = [...documents];
      for (let i = 0; i < newDocs.length; i++) {
        const doc = newDocs[i];
        if (doc.status === 'ready' && doc.blob) continue;
        
        try {
          const newPdf = await PDFLib.PDFDocument.create();
          const indices = Array.from({ length: doc.endPage - doc.startPage + 1 }, (_, idx) => doc.startPage + idx - 1)
            .filter(idx => idx >= 0 && idx < pdfDoc.getPageCount());
          
          const copiedPages = await newPdf.copyPages(pdfDoc, indices);
          copiedPages.forEach((page: any) => newPdf.addPage(page));
          const pdfBytes = await newPdf.save();
          const sha256 = await calculateSHA256(pdfBytes);
          
          newDocs[i] = {
            ...doc,
            blob: new Blob([pdfBytes], { type: 'application/pdf' }),
            sha256,
            status: 'ready'
          };
          setDocuments([...newDocs]);
          setProgress(`Forensic Extraction: ${i+1}/${newDocs.length}`);
        } catch (e) {
          newDocs[i] = { ...doc, status: 'error' };
          setDocuments([...newDocs]);
        }
      }
      setWorkflowStep('finalized');
    } catch (err: any) {
      setError(err.message || "Binary splitting failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const bulkAddTag = (tag: string) => {
    if (!tag) return;
    const newDocs = documents.map(doc => 
      doc.selected && !doc.tags.includes(tag) ? { ...doc, tags: [...doc.tags, tag] } : doc
    );
    pushToHistory(newDocs);
  };

  const bulkUpdateCategory = (cat: string) => {
    if (!cat) return;
    const newDocs = documents.map(doc => doc.selected ? { ...doc, category: cat } : doc);
    pushToHistory(newDocs);
  };

  const toggleSelect = (id: string) => {
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d));
  };

  const selectAll = (val: boolean) => {
    setDocuments(prev => prev.map(d => ({ ...d, selected: val })));
  };

  const updateDocField = (id: string, field: keyof ExtractedDocument, value: any) => {
    const newDocs = documents.map(d => d.id === id ? { ...d, [field]: value } : d);
    pushToHistory(newDocs);
  };

  const deleteDocument = (id: string) => {
    const newDocs = documents.filter(d => d.id !== id);
    pushToHistory(newDocs);
  };

  const getDocFilename = (doc: ExtractedDocument) => `${doc.category.replace(/\s+/g, '_')}_${doc.title.replace(/[^a-z0-9]/gi, '_')}.pdf`;

  const downloadFile = (doc: ExtractedDocument) => {
    if (!doc.blob) return;
    const url = URL.createObjectURL(doc.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getDocFilename(doc);
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateCSVData = () => {
    const headers = ["Title", "Category", "Description", "Start Page", "End Page", "SHA256_Fingerprint", "Tags", "Notes", "Filename"];
    const rows = documents.map(doc => [
      `"${doc.title.replace(/"/g, '""')}"`,
      `"${doc.category.replace(/"/g, '""')}"`,
      `"${doc.description.replace(/"/g, '""')}"`,
      doc.startPage,
      doc.endPage,
      doc.sha256 || 'N/A',
      `"${doc.tags.join(", ").replace(/"/g, '""')}"`,
      `"${doc.notes.replace(/"/g, '""')}"`,
      `"${getDocFilename(doc)}"`
    ]);
    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  };

  const handleExportCSV = () => {
    const csvContent = generateCSVData();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `integrity_report_${new Date().getTime()}.csv`;
    link.click();
  };

  const handleDownloadAll = async () => {
    const readyDocs = documents.filter(d => d.status === 'ready' && d.blob);
    if (readyDocs.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (const doc of readyDocs) { if (doc.blob) zip.file(getDocFilename(doc), doc.blob); }
      zip.file("integrity_report.csv", generateCSVData());
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `Document_Bundle_${new Date().getTime()}.zip`;
      a.click();
    } finally {
      setIsZipping(false);
    }
  };

  const handleDriveExport = async () => {
    const readyDocs = documents.filter(d => d.status === 'ready' && d.blob);
    if (readyDocs.length === 0) return;
    setDriveStatus('auth');
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '8675309-placeholder.apps.googleusercontent.com', 
        scope: SCOPES,
        callback: async (response: any) => {
          if (response.error !== undefined) throw response;
          setDriveStatus('uploading');
          const zip = new JSZip();
          for (const doc of readyDocs) { if (doc.blob) zip.file(getDocFilename(doc), doc.blob); }
          zip.file("integrity_report.csv", generateCSVData());
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const metadata = { name: `Bundle_${new Date().getTime()}.zip`, mimeType: 'application/zip' };
          const form = new FormData();
          form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          form.append('file', zipBlob);
          await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: new Headers({ 'Authorization': 'Bearer ' + response.access_token }),
            body: form,
          });
          setDriveStatus('success');
          setTimeout(() => setDriveStatus('idle'), 3000);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      setDriveStatus('idle');
      setError("Cloud Drive Export Failed. Ensure your Client ID is valid.");
    }
  };

  const selectedCount = documents.filter(d => d.selected).length;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto text-slate-900 pb-20 selection:bg-indigo-100 selection:text-indigo-700">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-8">
        <div>
          <h1 className="text-6xl font-black text-slate-800 tracking-tighter uppercase italic leading-none">DocIntelligence <span className="text-indigo-600">Pro</span></h1>
          <p className="text-slate-500 mt-3 font-medium text-xl">Forensic AI Document Deconstruction Engine</p>
        </div>
        <div className="flex gap-3">
           <button onClick={undo} disabled={history.length === 0} className="p-4 bg-white border-2 border-slate-200 rounded-2xl hover:border-indigo-500 disabled:opacity-30 transition-all shadow-sm group" title="Undo (Ctrl+Z)">
             <svg className="w-6 h-6 group-active:scale-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
           </button>
           <button onClick={redo} disabled={redoStack.length === 0} className="p-4 bg-white border-2 border-slate-200 rounded-2xl hover:border-indigo-500 disabled:opacity-30 transition-all shadow-sm group" title="Redo (Ctrl+Y)">
             <svg className="w-6 h-6 group-active:scale-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"/></svg>
           </button>
        </div>
      </header>

      {workflowStep === 'upload' && (
        <div className="space-y-10 animate-in fade-in zoom-in duration-700">
          <div className="bg-white p-12 rounded-[3rem] border-2 border-slate-100 shadow-2xl text-center relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
            <h2 className="text-3xl font-black mb-6 tracking-tight uppercase">Ingest Intelligence Bundle</h2>
            <p className="text-slate-500 mb-10 max-w-xl mx-auto text-lg leading-relaxed font-medium">Upload the OCR-searchable version of your bundle. Our forensic engine will analyze text flow, metadata patterns, and page logic to map boundaries.</p>
            <div className="flex flex-col items-center gap-8">
               <div className="w-full max-w-lg space-y-2 text-left">
                  <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-2">System Context Hint</label>
                  <input type="text" value={contextHint} onChange={e => setContextHint(e.target.value)} className="w-full p-5 bg-slate-50 border-2 border-slate-200 rounded-2xl font-bold outline-none focus:border-indigo-500 transition-all shadow-inner" placeholder="e.g. Divorce Evidence Bundle 2024" />
               </div>
               <div className="w-full max-w-lg space-y-2 text-left">
                  <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-2">Intelligence File (Searchable PDF)</label>
                  <div className="p-8 border-4 border-dashed border-slate-200 rounded-[2rem] hover:border-indigo-200 transition-all bg-slate-50/50 group/drop">
                    <input type="file" accept=".pdf" onChange={e => setOcrFile(e.target.files?.[0] || null)} className="block w-full text-sm text-slate-500 file:mr-4 file:py-3 file:px-8 file:rounded-full file:border-0 file:text-sm file:font-black file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer" />
                  </div>
               </div>
               <button onClick={startAnalysis} disabled={!ocrFile || isProcessing} className="px-16 py-6 bg-slate-900 text-white rounded-[2.5rem] font-black uppercase tracking-widest hover:bg-black hover:scale-105 active:scale-95 transition-all shadow-2xl disabled:bg-slate-200 text-lg">
                 {isProcessing ? `AI Processing...` : 'Analyze & Map Boundaries'}
               </button>
               {isProcessing && <p className="text-indigo-600 font-black animate-pulse uppercase tracking-[0.2em] text-xs">{progress}</p>}
            </div>
          </div>
        </div>
      )}

      {workflowStep !== 'upload' && (
        <div className="space-y-10 animate-in slide-in-from-bottom-10 duration-700">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8 bg-slate-900 text-white p-10 rounded-[3.5rem] shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/20 to-transparent pointer-events-none"></div>
             
             <div className="z-10 relative">
                <div className="flex items-center gap-3 mb-2">
                   <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
                   <h2 className="text-4xl font-black tracking-tight uppercase italic">{workflowStep === 'review' ? 'Review Phase' : 'Extraction Finalized'}</h2>
                </div>
                <p className="text-slate-400 font-bold text-sm uppercase tracking-widest ml-6">{documents.length} Distinct Records Map Identified</p>
             </div>

             <div className="flex flex-wrap items-center justify-center gap-4 z-10">
                {workflowStep === 'review' && (
                  <div className="flex flex-col items-end gap-3 bg-white/5 p-4 rounded-3xl border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                         <div className="text-[10px] font-black uppercase text-indigo-400">Master Source Required</div>
                         <input type="file" accept=".pdf" onChange={e => setScansFile(e.target.files?.[0] || null)} className="text-[10px] w-48 text-white/50" />
                      </div>
                      <button onClick={finalizeSplit} disabled={isProcessing || !scansFile} className="px-8 py-4 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-black text-sm active:scale-95 shadow-xl flex items-center gap-2 uppercase tracking-widest disabled:opacity-30 group transition-all">
                         <svg className="w-5 h-5 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5"/></svg>
                         Commit Forensic Split
                      </button>
                    </div>
                  </div>
                )}
                {workflowStep === 'finalized' && (
                  <div className="flex flex-wrap gap-3">
                    <button onClick={handleExportCSV} className="px-6 py-4 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-black text-xs uppercase tracking-widest border border-white/10 active:scale-95 transition-all">Integrity CSV</button>
                    <button onClick={handleDownloadAll} className="px-8 py-4 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center gap-2">
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                       ZIP BUNDLE
                    </button>
                    <button onClick={handleDriveExport} className="px-6 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest border border-white/10 active:scale-95 transition-all">Sync Drive</button>
                  </div>
                )}
                <button onClick={() => { if(confirm("Discard all progress and reset session?")) { localStorage.removeItem('doc_intelligence_wip'); window.location.reload(); } }} className="px-5 py-4 bg-red-900/20 hover:bg-red-900/40 text-red-200 rounded-2xl font-black text-xs uppercase tracking-widest border border-red-900/20 active:scale-95 transition-all">Clear All</button>
             </div>
          </div>

          {/* Bulk Actions Floating Bar */}
          {selectedCount > 0 && (
            <div className="sticky top-6 z-50 bg-indigo-600 text-white p-6 rounded-[2.5rem] shadow-2xl flex flex-wrap items-center justify-between gap-6 animate-in slide-in-from-top-20 duration-500 border-2 border-white/20">
               <div className="flex items-center gap-5">
                  <span className="bg-white text-indigo-600 w-10 h-10 rounded-full flex items-center justify-center font-black text-xl shadow-inner">{selectedCount}</span>
                  <div>
                    <span className="font-black text-lg uppercase tracking-widest leading-none block">Records Selected</span>
                    <span className="text-indigo-200 text-[10px] font-black uppercase tracking-widest">Apply Batch Logic</span>
                  </div>
               </div>
               <div className="flex gap-3">
                  <button onClick={() => bulkUpdateCategory(prompt("Assign New Category:") || "")} className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-black uppercase tracking-widest border border-white/20 active:scale-95 transition-all">Categorize</button>
                  <button onClick={() => bulkAddTag(prompt("Add Shared Tag:") || "")} className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-black uppercase tracking-widest border border-white/20 active:scale-95 transition-all">Tag All</button>
                  <button onClick={() => selectAll(false)} className="px-6 py-3 bg-indigo-900/50 hover:bg-indigo-900/70 rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all">Deselect</button>
               </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-8">
            <div className="flex items-center gap-4 px-6 py-3 border-b-2 border-slate-100">
               <input type="checkbox" onChange={(e) => selectAll(e.target.checked)} checked={selectedCount === documents.length} className="w-6 h-6 rounded-lg border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
               <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Select All Identified Segments</span>
            </div>
            
            {documents.map((doc) => (
              <div key={doc.id} className={`bg-white p-10 rounded-[3rem] border-2 transition-all duration-700 flex items-start gap-8 ${doc.selected ? 'border-indigo-500 shadow-2xl ring-4 ring-indigo-50 bg-indigo-50/5' : 'border-slate-100 hover:border-slate-200 hover:shadow-xl'}`}>
                <div className="flex flex-col items-center gap-4">
                  <input type="checkbox" checked={doc.selected} onChange={() => toggleSelect(doc.id)} className="w-8 h-8 rounded-xl border-slate-200 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer shadow-sm" />
                  <div className={`w-1 h-full rounded-full transition-colors ${doc.status === 'ready' ? 'bg-emerald-400' : 'bg-slate-100'}`}></div>
                </div>
                
                <div className="flex-1 flex flex-col md:flex-row justify-between gap-10">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-5 mb-6">
                      {editingId === doc.id ? (
                        <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Category</label>
                          <input type="text" value={doc.category} onChange={(e) => updateDocField(doc.id, 'category', e.target.value)} className="text-[10px] font-black uppercase rounded-xl border-2 border-slate-200 px-4 py-2 outline-none focus:border-indigo-500 block w-48 bg-slate-50 shadow-inner" />
                        </div>
                      ) : (
                        <span className={`px-5 py-2 text-[10px] font-black uppercase rounded-full text-white tracking-widest shadow-sm ${getCategoryColor(doc.category)}`}>
                          {doc.category}
                        </span>
                      )}
                      
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Page Span</span>
                        {editingId === doc.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input type="number" value={doc.startPage} onChange={e => updateDocField(doc.id, 'startPage', parseInt(e.target.value))} className="w-16 text-xs font-black border-2 rounded-xl p-2 bg-slate-50" />
                            <span className="text-slate-300 font-bold">to</span>
                            <input type="number" value={doc.endPage} onChange={e => updateDocField(doc.id, 'endPage', parseInt(e.target.value))} className="w-16 text-xs font-black border-2 rounded-xl p-2 bg-slate-50" />
                          </div>
                        ) : (
                          <span className="text-sm text-slate-900 font-black">{doc.startPage} — {doc.endPage}</span>
                        )}
                      </div>

                      {doc.status === 'ready' && (
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black uppercase text-emerald-600 tracking-widest">Integrity Verified</span>
                          <span className="text-[10px] text-emerald-800 font-mono tracking-tighter bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100 shadow-sm">SHA256: {doc.sha256?.substring(0, 16)}...</span>
                        </div>
                      )}
                    </div>

                    {editingId === doc.id ? (
                      <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div className="space-y-2">
                             <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-2">Record Title</label>
                             <input type="text" value={doc.title} onChange={(e) => updateDocField(doc.id, 'title', e.target.value)} className="w-full font-black text-2xl border-2 border-slate-200 rounded-2xl outline-none p-4 bg-slate-50 focus:border-indigo-500 shadow-inner" />
                          </div>
                          <div className="space-y-2">
                             <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-2">Metadata Tags</label>
                             <input type="text" value={doc.tags.join(", ")} onChange={(e) => updateDocField(doc.id, 'tags', e.target.value.split(",").map(s => s.trim()).filter(s => s))} className="w-full font-bold text-sm border-2 border-slate-200 rounded-2xl outline-none p-4 bg-slate-50 focus:border-indigo-500 shadow-inner" placeholder="Evidence, Redacted, Priority..." />
                          </div>
                        </div>
                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-2">Intelligence Summary</label>
                           <textarea value={doc.description} onChange={(e) => updateDocField(doc.id, 'description', e.target.value)} className="w-full text-slate-600 border-2 border-slate-200 rounded-2xl p-4 outline-none text-sm font-medium bg-slate-50 focus:border-indigo-500 shadow-inner" rows={2} />
                        </div>
                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-amber-600 tracking-widest ml-2">Internal Forensic Note (Sticky)</label>
                           <textarea value={doc.notes} onChange={(e) => updateDocField(doc.id, 'notes', e.target.value)} className="w-full text-slate-700 bg-amber-50/50 border-2 border-amber-100 rounded-2xl p-4 outline-none text-sm italic font-medium focus:border-amber-400 shadow-inner" rows={3} placeholder="Add specific details that stick to this document's metadata..." />
                        </div>
                      </div>
                    ) : (
                      <div className="group/content transition-all">
                        <h3 className="text-3xl font-black text-slate-900 mb-3 group-hover/content:text-indigo-600 transition-colors tracking-tight">{doc.title}</h3>
                        <p className="text-slate-500 leading-relaxed font-medium mb-6 text-lg">{doc.description}</p>
                        
                        <div className="flex flex-wrap gap-3 mb-6">
                          {doc.tags.map(tag => (
                            <span key={tag} className="px-3 py-1 bg-slate-50 text-slate-500 rounded-lg text-[10px] font-black border-2 border-slate-100 uppercase tracking-widest shadow-sm">#{tag}</span>
                          ))}
                          {doc.tags.length === 0 && <span className="text-[10px] font-black text-slate-300 uppercase italic tracking-widest">No tags assigned</span>}
                        </div>

                        {doc.notes && (
                          <div className="bg-amber-50/80 border-l-8 border-amber-300 p-6 rounded-r-[2rem] shadow-sm relative group/note overflow-hidden">
                             <div className="absolute top-0 right-0 p-4 opacity-5 group-hover/note:opacity-20 transition-opacity">
                                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 14H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                             </div>
                             <div className="flex items-center gap-3 text-amber-700 mb-2">
                               <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path></svg>
                               <span className="text-xs font-black uppercase tracking-[0.2em]">Forensic Note</span>
                             </div>
                             <p className="text-slate-800 text-base italic font-semibold leading-relaxed">{doc.notes}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-4 min-w-[200px]">
                    {workflowStep === 'finalized' && doc.status === 'ready' ? (
                      <button onClick={() => downloadFile(doc)} className="w-full py-5 bg-slate-900 text-white rounded-[1.5rem] font-black text-sm hover:bg-indigo-600 active:scale-95 transition-all shadow-xl uppercase tracking-widest flex items-center justify-center gap-3">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        Export PDF
                      </button>
                    ) : (
                      <div className="w-full py-5 bg-slate-50 text-slate-300 rounded-[1.5rem] font-black text-xs text-center uppercase tracking-widest border-2 border-dashed border-slate-200 italic">
                        Binary Pending
                      </div>
                    )}
                    <button onClick={() => setEditingId(editingId === doc.id ? null : doc.id)} className={`w-full py-4 rounded-[1.5rem] font-black text-xs uppercase border-2 transition-all shadow-sm ${editingId === doc.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-200' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-400 hover:text-indigo-600'}`}>
                      {editingId === doc.id ? 'Commit Changes' : 'Review & Annotate'}
                    </button>
                    <button onClick={() => { if(confirm("Discard this segment from the bundle?")) deleteDocument(doc.id); }} className="w-full py-2 text-[10px] font-black uppercase text-red-400 hover:text-red-600 transition-colors tracking-widest flex items-center justify-center gap-2">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                      Exclude Item
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="fixed bottom-12 right-12 p-8 bg-red-600 text-white rounded-[2.5rem] shadow-2xl z-[100] animate-in slide-in-from-right-20 flex items-center gap-6 border-4 border-red-500/50">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center animate-bounce">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] opacity-80">System Error</div>
            <div className="font-black text-lg leading-tight">{error}</div>
          </div>
          <button onClick={() => setError(null)} className="ml-4 w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-all text-2xl font-black">✕</button>
        </div>
      )}
      
      {isZipping && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xl z-[200] flex flex-col items-center justify-center animate-in fade-in duration-500">
           <div className="w-24 h-24 border-8 border-indigo-600 border-t-transparent rounded-full animate-spin mb-8 shadow-2xl shadow-indigo-500/50"></div>
           <h3 className="text-white text-4xl font-black tracking-tighter uppercase italic">Assembling Bundle...</h3>
           <p className="text-indigo-200 font-bold tracking-widest uppercase text-xs mt-4">Binary Serialization in Progress</p>
        </div>
      )}
    </div>
  );
};

export default App;
