import { openAiProxyCorsExposedHeaders } from "../modules/openai-proxy/helpers.js";

export const apiCorsOptions = {
  origin: true,
  credentials: true,
  exposedHeaders: openAiProxyCorsExposedHeaders
};
