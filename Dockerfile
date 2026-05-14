FROM node:20-alpine

# Install FFmpeg + Python edge-tts CLI fallback
RUN apk add --no-cache ffmpeg python3 py3-pip libc6-compat && \
    pip3 install --break-system-packages edge-tts 2>/dev/null || true

WORKDIR /app

# Install all dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Create temp dir for generated videos
RUN mkdir -p /tmp/stock-shorts

EXPOSE 3000

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV NEXT_TELEMETRY_DISABLED=1

CMD ["npm", "start"]
