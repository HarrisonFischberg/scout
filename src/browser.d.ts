// Minimal ambient types for the Safari WebExtension `browser` namespace.
// Only what src/ uses. Replace with full typings when more APIs are used.
declare const browser: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (message: unknown) => Promise<unknown> | unknown,
      ): void;
    };
  };
};
