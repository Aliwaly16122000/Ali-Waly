FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=client /app/client/dist ./client/dist
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "server/src/index.js"]
