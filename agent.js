// SPDX-FileCopyrightText: 2024 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0
// import type { JobProcess } from '@livekit/agents';
import {
  AutoSubscribe,
  // type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  pipeline,
} from '@livekit/agents';
import { VAD } from '@livekit/agents/dist/vad.js';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = new VAD({
      threshold: 0.5,
      minSilenceDuration: 100,
      minSpeechDuration: 250,
      windowSize: 512,
      sampleRate: 16000
    });
  },
  entry: async (ctx) => {
    const vad = ctx.proc.userData.vad;
    const initialContext = new llm.ChatContext().append({
      role: llm.ChatRole.SYSTEM,
      text:
        'You are a voice assistant created by LiveKit. Your interface with users will be voice. ' +
        'You should use short and concise responses, and avoiding usage of unpronounceable ' +
        'punctuation.',
    });

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    console.log('waiting for participant');
    const participant = await ctx.waitForParticipant();
    console.log(`starting assistant example agent for ${participant.identity}`);

    const fncCtx = {
      weather: {
        description: 'Get the weather in a location',
        parameters: z.object({
          location: z.string().describe('The location to get the weather for'),
        }),
        execute: async ({ location }) => {
          console.debug(`executing weather function for ${location}`);
          const response = await fetch(`https://wttr.in/${location}?format=%C+%t`);
          if (!response.ok) {
            throw new Error(`Weather API returned status: ${response.status}`);
          }
          const weather = await response.text();
          return `The weather in ${location} right now is ${weather}.`;
        },
      },
    };

    const voiceAgent = new pipeline.VoicePipelineAgent(
      vad,
      new deepgram.STT(),
      new openai.LLM(),
      new openai.TTS(),
      { chatCtx: initialContext, fncCtx },
    );

    // Add onStart event handler before starting the agent
    voiceAgent.on('start', async () => {
      await voiceAgent.say('Welcome! I am your AI assistant. How can I help you today?', true);
    });

    voiceAgent.start(ctx.room, participant);
  },
});

cli.runApp(new WorkerOptions({ 
  agent: fileURLToPath(import.meta.url),
  url: process.env.LIVEKIT_URL,
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET
}));