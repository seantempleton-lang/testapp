FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["npm", "start"]
