
# DocIntelligence Pro 🚀
### Enterprise AI Document Decomposition & Forensic Integrator

**DocIntelligence Pro** is a high-performance, privacy-first web application designed to transform massive, disorganized PDF bundles into structured, verified, and annotated digital assets. Using Google Gemini AI, it identifies document boundaries with human-like reasoning and reconstructs high-resolution files locally.

---

## 🌟 Core Features

### 🧠 Intelligence & Classification
- **Domain-Agnostic Context**: Calibrate the AI engine for Legal, Medical, HR, or Financial bundles using a simple "Context Hint".
- **Dynamic Classification**: AI automatically identifies document types (e.g., "Lab Results", "Mortgage Deed", "Pleading") based on content.
- **Smart Summaries**: Automatically generates descriptive titles and summaries for every extracted record.

### 🛡️ Forensic Integrity
- **SHA-256 Fingerprinting**: Every extracted PDF is hashed using the Web Crypto API. This provides a cryptographically secure "digital fingerprint" for legal and medical non-repudiation.
- **Integrity Reports**: Every export includes a CSV/JSON report mapping filenames to their unique SHA-256 hashes.

### 🛠️ Professional Workflow
- **Forensic Undo/Redo**: Full state history management. Revert any metadata change, category update, or tag addition instantly.
- **Batch Processing**: Select multiple records to apply tags or update categories in bulk.
- **WIP Persistence**: Your progress is automatically saved to local storage. Close your browser and resume exactly where you left off.
- **Staging Area**: A "Review-before-Split" workflow allows you to refine AI-detected boundaries before performing resource-intensive PDF operations.

---

## 📂 Export Capabilities

- **ZIP Archive**: All extracted high-res PDFs bundled with a master integrity report.
- **CSV/JSON Metadata**: Professional-grade metadata exports optimized for direct ingestion into case management systems (Clio, Salesforce, MyCase).
- **Google Drive Sync**: Direct-to-cloud export for distributed teams.

---

## 🛠 Technical Architecture

- **AI Reasoning**: Google Gemini 3 Flash Preview (`gemini-3-flash-preview`) for boundary detection and summarization.
- **PDF Processing**: `pdf-lib` for local, bit-level binary reconstruction and `pdf.js` for high-speed text extraction.
- **Security**: Data never leaves the browser. The AI only "sees" extracted text snippets; the actual document binary remains safely in local memory.
- **Hashing**: Native Browser `crypto.subtle` for high-speed SHA-256 calculation.

---

## 🚀 Deployment Guide

1. **Prerequisites**: Ensure you have a valid Google Gemini API Key.
2. **Environment**: The application expects `process.env.API_KEY` to be available.
3. **Google Drive Integration**: Update the `client_id` in `App.tsx` with your Google Cloud Console project ID to enable Drive Sync.

---

## 📜 Privacy Statement
DocIntelligence Pro is a client-side application. Your documents are processed locally. Only text metadata is transmitted to the Google Generative AI API for processing. We do not store, view, or collect your files.
