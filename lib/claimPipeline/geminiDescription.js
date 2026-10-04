const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function generateDescription({ awb, subOrderId, packetId, code, returnReason }) {
  if (!process.env.GEMINI_API_KEY) {
    return `Wrong/Damaged return received for SubOrder: ${subOrderId || 'N/A'}, AWB: ${awb}. Physical condition does not match dispatch. Issue code: ${code}.`;
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const prompt = `You are an automated claims filing assistant for an e-commerce seller on Meesho.
Generate a concise, professional claim description (under 120 words) for a return claim.
Details:
- Reverse AWB: ${awb}
- Sub-Order ID: ${subOrderId || 'N/A'}
- Packet ID: ${packetId || 'N/A'}
- Return Issue Code: ${code}
- Portal Return Reason: ${returnReason || 'Customer return / damaged / wrong item'}

Focus strictly on factual evidence: parcel was received tampered/damaged/wrong product inside, unboxing video and images attached. Request immediate compensation. No fluff.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini description generation fallback:', err.message);
    return `Return package received with defect/wrong item for AWB ${awb}. Unboxing video and physical photos attached as proof. Kindly approve claim.`;
  }
}

module.exports = { generateDescription };