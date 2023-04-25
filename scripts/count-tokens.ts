import { encode, decode } from 'gpt-3-encoder';

// export function that counts the number of tokens for a string of text
export function countTokens(text: string): number {
  return encode(text).length;
}

export function countAllTokens(...args: any): number {
  return args.reduce((acc: 0, arg: any) => {
    return acc + countTokens(JSON.stringify(arg));
  }, 0);
}
