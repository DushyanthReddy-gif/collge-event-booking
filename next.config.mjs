/** @type {import('next').NextConfig} */
const nextConfig = {
  // The local embedding model uses native modules; keep them out of the webpack bundle.
  serverExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp', 'pg', 'neo4j-driver'],
};
export default nextConfig;
