FROM node:24-bookworm-slim
ENV NODE_ENV=production COSMICDESK_AUTO_UPDATE=0
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
USER node
EXPOSE 3014
CMD ["node", "server.js"]
