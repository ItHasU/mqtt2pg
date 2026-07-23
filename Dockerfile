# -- Build stage: compile TypeScript to dist/ -------------------------------
FROM node:24-slim AS build
WORKDIR /app

# Install dependencies against the lockfile for a reproducible build.
COPY package.json package-lock.json ./
RUN npm ci

# Compile the sources.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# -- Runtime stage: production dependencies only, non-root ------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Only production dependencies end up in the final image (no TypeScript toolchain).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled output from the build stage.
COPY --from=build /app/dist ./dist

# Drop privileges: run as the unprivileged `node` user shipped by the base image.
USER node

CMD ["node", "dist/main.js"]
