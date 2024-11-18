import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import dotenv from 'dotenv';
import { Room } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

// Load environment variables
dotenv.config();

// Initialize Fastify
const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// WebSocket handler for voice streaming
fastify.register(async function (fastify) {
  fastify.get('/voice-stream', { websocket: true }, async (connection) => {
    console.log('Client connected');
    let streamSid = null;
    let livekitRoom = null;

    try {
      // Create token for LiveKit connection
      const at = new AccessToken(
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET,
        { identity: 'twilio-caller' }
      );
      at.addGrant({ 
        roomJoin: true,
        room: 'twilio-room',  // This should match the room the agent joins
      });
      const token = await at.toJwt();
console.log('access token is: ', token);

      // Connect to LiveKit room
      livekitRoom = new Room();
      await livekitRoom.connect(process.env.LIVEKIT_URL, token);
      console.log('Connected to LiveKit room');

      // Send initial greeting data
      const greetingData = {
        type: 'greeting',
        text: 'Hello from Twilio caller!'
      };

      // Ensure we're sending a proper Buffer of JSON data
      const greetingBuffer = Buffer.from(JSON.stringify(greetingData));
      
      await livekitRoom.localParticipant.publishData(greetingBuffer, {
        reliable: true,
        name: 'greeting',
        kind: 'data'
      });

      // Handle incoming messages from Twilio
      connection.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          console.log('Received from Twilio:', data.event);
          
          switch (data.event) {
            case 'start':
              streamSid = data.start.streamSid;
              console.log('Stream started:', streamSid);
              connection.send(JSON.stringify({ 
                event: 'mark',
                streamSid: streamSid 
              }));
              break;

            case 'media':
              if (data.media && data.media.payload && livekitRoom?.localParticipant) {
                try {
                  // Get raw audio buffer from Twilio
                  const audioBuffer = Buffer.from(data.media.payload, 'base64');
                  
                  // Send raw audio data directly
                  await livekitRoom.localParticipant.publishData(audioBuffer, {
                    reliable: false,
                    name: 'audio',
                    kind: 'data'
                  });

                } catch (error) {
                  console.error('Error publishing audio:', error);
                }
              }
              connection.send(JSON.stringify({ 
                event: 'mark',
                streamSid: streamSid 
              }));
              break;

            case 'stop':
              console.log('Stream stopped:', streamSid);
              if (livekitRoom) {
                livekitRoom.disconnect();
              }
              break;
          }
        } catch (error) {
          console.error('Error processing message:', error);
          if (streamSid) {
            connection.send(JSON.stringify({ 
              event: 'mark',
              streamSid: streamSid 
            }));
          }
        }
      });

      // Keep-alive interval
      const keepAliveInterval = setInterval(() => {
        if (connection.readyState === 1 && streamSid) {
          connection.send(JSON.stringify({ 
            event: 'mark',
            streamSid: streamSid 
          }));
        }
      }, 250);

      // Cleanup
      connection.on('close', () => {
        console.log('Twilio client disconnected');
        clearInterval(keepAliveInterval);
        if (livekitRoom) {
          livekitRoom.disconnect();
        }
      });

    } catch (error) {
      console.error('Error in WebSocket setup:', error);
      connection.send(JSON.stringify({ error: 'Internal server error' }));
    }
  });
});

// Handle incoming Twilio calls
fastify.all('/incoming-call', async (request, reply) => {
  try {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/voice-stream" />
        </Connect>
      </Response>`;

    reply.type('text/xml').send(twimlResponse);
  } catch (error) {
    console.error('Error handling incoming call:', error);
    reply.code(500).send('Internal server error');
  }
});

// Start the server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start(); 