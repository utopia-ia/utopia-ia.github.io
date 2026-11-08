import { serveTask } from '../elffuss-ai/sdk/core/worker-rpc.js';
import * as impl from './vad-impl.js';
serveTask(impl);
