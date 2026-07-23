# -- Build stage: compile TypeScript to dist/ -------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies against the lockfile for a reproducible build.
COPY package.json package-lock.json ./
RUN npm ci

# Compile the sources.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# -- Runtime stage: production dependencies only, non-root ------------------
# Alpine keeps the final image small; the runtime deps (mqtt, pg) are pure JS,
# so no native toolchain or glibc is required.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Only production dependencies end up in the final image (no TypeScript toolchain).
# --ignore-scripts avoids running package install hooks (safe here: pure-JS deps).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy the compiled output from the build stage.
COPY --from=build /app/dist ./dist

# Drop privileges: run as the unprivileged `node` user shipped by the base image.
USER node

CMD ["node", "dist/main.js"]
