# Multi-stage build for palantir-for-family-trips (React 19 + Vite)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifest + lockfile for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source + build-time env (VITE_* are inlined into the bundle)
COPY . .
ARG VITE_GOOGLE_MAPS_API_KEY=""
ARG VITE_GOOGLE_MAP_ID=""
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAP_ID=$VITE_GOOGLE_MAP_ID

RUN npm run build

# Runtime: nginx serving the SPA
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
