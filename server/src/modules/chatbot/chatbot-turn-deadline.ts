import { CHATBOT_TURN_TIMEOUT_MS } from '../../libs/constants/chatbot.constant';

export class ChatbotTurnTimeoutError extends Error {
  constructor() {
    super('Chatbot turn timed out');
  }
}

// All reads share this deadline. A timed-out operation may ignore cancellation,
// but wait() detaches its result so it cannot resume the model/tool loop.
export class ChatbotTurnDeadline {
  private readonly controller = new AbortController();
  private readonly expiresAt = Date.now() + CHATBOT_TURN_TIMEOUT_MS;
  private readonly timer = setTimeout(
    () => this.controller.abort(new ChatbotTurnTimeoutError()),
    CHATBOT_TURN_TIMEOUT_MS,
  );

  readonly signal = this.controller.signal;

  assertActive(): void {
    if (this.signal.aborted || Date.now() >= this.expiresAt) {
      if (!this.signal.aborted) {
        this.controller.abort(new ChatbotTurnTimeoutError());
      }
      throw new ChatbotTurnTimeoutError();
    }
  }

  async wait<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new ChatbotTurnTimeoutError());
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          this.assertActive();
          return operation();
        }),
        aborted,
      ]);
      this.assertActive();
      return result;
    } finally {
      this.signal.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
