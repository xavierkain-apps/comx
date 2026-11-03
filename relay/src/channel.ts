import {DurableObject} from 'cloudflare:workers';
import type {Env} from './index';

export class Channel extends DurableObject<Env> {
  /** Replaced in tests. */
  clock: () => number = Date.now;

  async fetch(_request: Request): Promise<Response> {
    return Response.json({now: this.clock(), riders: [], events: [], cursor: 0, acked: []});
  }
}
