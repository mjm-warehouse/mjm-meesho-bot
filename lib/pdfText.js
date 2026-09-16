const pdfParse = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');

const OCR_SPACE_ENDPOINT = 'https://api.ocr.space/parse/image';

async function extractPages(buffer) {
  const rawPages = [];

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item) => item.str).join(' ');
      rawPages.push(text);
      return text;
    },
  });

  const pages = rawPages.map((text, i) => ({
    pageNumber: i + 1,
    text: text.trim(),
    needsOcr: text.trim().length < 15,
    ocrApplied: false,
  }));

  const anyNeedsOcr = pages.some((p) => p.needsOcr);
  if (anyNeedsOcr) {
    if (!process.env.OCR_SPACE_API_KEY) {
      return pages;
    }
    try {
      const ocrTexts = await runOcrSpace(buffer);
      pages.forEach((p) => {
        if (p.needsOcr && ocrTexts[p.pageNumber - 1]) {
          const ocrText = ocrTexts[p.pageNumber - 1].trim();
          if (ocrText.length >= 15) {
            p.text = ocrText;
            p.needsOcr = false;
            p.ocrApplied = true;
          }
        }
      });
    } catch (err) {
      console.error('OCR.space fallback failed:', err.message);
    }
  }

  return pages;
}

async function runOcrSpace(buffer) {
  const form = new FormData();
  form.append('apikey', process.env.OCR_SPACE_API_KEY);
  form.append('file', buffer, { filename: 'document.pdf', contentType: 'application/pdf' });
  form.append('filetype', 'PDF');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');

  const res = await axios.post(OCR_SPACE_ENDPOINT, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 30000,
  });

  if (res.data.IsErroredOnProcessing) {
    const msg = Array.isArray(res.data.ErrorMessage) ? res.data.ErrorMessage.join(', ') : 'OCR.space processing error';
    throw new Error(msg);
  }

  return (res.data.ParsedResults || []).map((r) => r.ParsedText || '');
}

module.exports = { extractPages };