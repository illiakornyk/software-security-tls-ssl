import readline from 'node:readline';

export interface CLICallbacks {
  onConnect: (target: string) => void;
  onSend: (target: string, message: string) => void;
  onBroadcast: (message: string) => void;
}

export class CLI {
  private myId: string;
  private callbacks: CLICallbacks;
  private rl: readline.Interface;

  constructor(myId: string, callbacks: CLICallbacks) {
    this.myId = myId;
    this.callbacks = callbacks;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  public start() {
    if (!process.stdin.isTTY) {
      console.log(`[CLI] Non-interactive mode (stdin is not a TTY). Commands disabled.`);
      return;
    }
    this.promptUser();
  }

  public promptUser() {
    this.rl.question(`Node ${this.myId} > `, (line) => {
      const [cmd, target, ...text] = line.split(' ');

      if (cmd === 'connect' && target) {
        this.callbacks.onConnect(target);
        setTimeout(() => this.promptUser(), 100);
      } else if (cmd === 'send' && target && text.length > 0) {
        this.callbacks.onSend(target, text.join(' '));
        setTimeout(() => this.promptUser(), 100);
      } else if (cmd === 'broadcast' && target) {
        const broadcastMsg = [target, ...text].join(' ');
        this.callbacks.onBroadcast(broadcastMsg);
        setTimeout(() => this.promptUser(), 100);
      } else {
        if (line.trim() !== '') {
          console.log('Usage:');
          console.log('  connect <targetID>   -> Start TLS Handshake');
          console.log('  send <targetID> <msg> -> Send text message');
          console.log('  broadcast <msg>      -> Send to everyone');
        }
        this.promptUser();
      }
    });
  }
}
