FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache git python3 make g++ tzdata haveged

# Set timezone (optional but recommended)
ENV TZ=Asia/Karachi
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Start haveged and bot
CMD ["sh", "-c", "haveged -F & npm start"]
