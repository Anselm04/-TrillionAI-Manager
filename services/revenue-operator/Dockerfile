FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY backend ./backend
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/sql ./backend/sql
USER node
EXPOSE 8080
CMD ["node","backend/dist/main.js"]
