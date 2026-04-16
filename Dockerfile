# Multi-stage build for palantir-for-family-trips (React 19 + Vite)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifest + lockfile for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source + build-time env (VITE_* are inlined into the bundle)
COPY . .
ARG VITE_MAP_STYLE_URL=""
ARG VITE_OSRM_BASE=""
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL
ENV VITE_OSRM_BASE=$VITE_OSRM_BASE

RUN npm run build

# Runtime: nginx serving the SPA
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
