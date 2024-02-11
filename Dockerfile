FROM node:18

COPY main.js package.json /app/
WORKDIR /app
RUN npm install

CMD ["node", "/app/main.js"]