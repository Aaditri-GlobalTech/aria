/** A listener for one complete transport message. */
export type TransportMessageListener<Message> = (message: Message) => void;

/** A listener for failures reported by the underlying transport. */
export type TransportErrorListener = (error: Error) => void;

/** A listener for the remote or local transport closing. */
export type TransportCloseListener = () => void;

/**
 * Runtime-neutral bidirectional transport contract.
 *
 * Messages are complete encoded values. The transport does not parse JSON or
 * add framing; those details belong to each adapter and its protocol users.
 */
export interface Transport<Incoming, Outgoing = Incoming> {
  send(message: Outgoing): Promise<void>;
  onMessage(listener: TransportMessageListener<Incoming>): () => void;
  onError(listener: TransportErrorListener): () => void;
  onClose(listener: TransportCloseListener): () => void;
  close(): Promise<void>;
}

/** Text transport used by the JSON-RPC host boundary. */
export type JsonRpcTransport = Transport<string, string>;
