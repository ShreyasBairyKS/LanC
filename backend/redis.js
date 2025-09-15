const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const pub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const CHANNELS = {
  DEVICES_UPDATED: 'devices:updated',
  PING_RESULT: 'ping:result',
  CHAT_MESSAGE: 'chat:message',
};

module.exports = { redis, pub, sub, CHANNELS };
