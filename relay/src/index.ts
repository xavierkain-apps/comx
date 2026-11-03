import {Channel} from './channel';

export {Channel};

export interface Env {
  CHANNEL: DurableObjectNamespace<Channel>;
  RELAY_KEY: string;
}

const ROUTE = /^\/v1\/channels\/([0-9a-f]{64})\/(sync|clips(?:\/[\w-]+)?)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('x-comx-key') !== env.RELAY_KEY) {
      return new Response('unauthorized', {status: 401});
    }
    const match = ROUTE.exec(new URL(request.url).pathname);
    if (!match) return new Response('not found', {status: 404});
    const stub = env.CHANNEL.get(env.CHANNEL.idFromName(match[1]));
    return stub.fetch(request);
  },
};
