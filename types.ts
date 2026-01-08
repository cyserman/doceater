
export interface ExtractedDocument {
  id: string;
  title: string;
  description: string;
  category: string;
  startPage: number;
  endPage: number;
  blob?: Blob;
  sha256?: string; 
  tags: string[];
  notes: string;
  status: 'pending' | 'processing' | 'ready' | 'error';
  selected?: boolean; // For bulk actions
}

export interface PDFMetadata {
  name: string;
  pageCount: number;
  size: number;
}
