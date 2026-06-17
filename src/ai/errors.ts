export class ProviderError extends Error {
  status?: number;
  provider?: string;

  constructor(message: string, status?: number, provider?: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.provider = provider;
  }
}

export function isRetryableStatus(status: number | undefined, retryOn: number[]): boolean {
  if (status === undefined) return false;
  return retryOn.includes(status);
}
