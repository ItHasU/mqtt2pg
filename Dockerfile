FROM node:18

COPY main.js package.json /app/
RUN npm install

WORKDIR /app
CMD ["node", "/app/main.js"]