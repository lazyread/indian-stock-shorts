/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'edge-tts-universal',
      'googleapis',
    ],
  },
};

export default nextConfig;
