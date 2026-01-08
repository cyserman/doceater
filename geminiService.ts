
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedDocument } from "./types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeDocumentBoundaries(
  textByPage: string[], 
  contextHint: string = "General Document Bundle"
): Promise<Partial<ExtractedDocument>[]> {
  const prompt = `
    I am providing the text content of a large PDF bundle, page by page. 
    The context of this bundle is: "${contextHint}".
    
    Your task is to identify individual distinct documents within this bundle based on the provided context.
    For example, if it's a medical bundle, look for lab results, doctor notes, and prescriptions.
    If it's legal, look for orders and motions. 
    If it's financial, look for statements and tax forms.
    
    For each distinct document found, provide:
    1. A descriptive title.
    2. A brief summary/description of the document.
    3. A category name (be creative based on the context).
    4. The starting page number (1-indexed).
    5. The ending page number (1-indexed).

    Here is the text content:
    ${textByPage.map((text, i) => `--- PAGE ${i + 1} ---\n${text.substring(0, 1000)}`).join('\n\n')}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { 
                type: Type.STRING,
                description: "The type of document identified (e.g., 'Invoice', 'Lab Result', 'Contract')"
            },
            startPage: { type: Type.INTEGER },
            endPage: { type: Type.INTEGER }
          },
          required: ["title", "description", "category", "startPage", "endPage"]
        }
      }
    }
  });

  try {
    const data = JSON.parse(response.text || '[]');
    return data;
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}
