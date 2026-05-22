FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY public ./public
COPY server.mjs ./

ENV HOST=0.0.0.0
ENV NODE_ENV=production
EXPOSE 3456

CMD ["npm", "start"]
