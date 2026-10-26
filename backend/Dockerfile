FROM node:24.10.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/server.ts"]
