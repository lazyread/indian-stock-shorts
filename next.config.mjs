/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'fluent-ffmpeg',
      'sharp',
      'googleapis',
    ],
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        'fluent-ffmpeg',
        'sharp',
      ];
    }
    return config;
  },
};

export default nextConfig;
