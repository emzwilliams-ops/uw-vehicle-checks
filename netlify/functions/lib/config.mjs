
export const DEFAULT_MOT_LOOKUP_URL = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{registration}';
export const DEFAULT_MOT_SCOPE = 'https://tapi.dvsa.gov.uk/.default';

export function getAppConfig() {
  return {
    dvlaApiKey: process.env.DVLA_API_KEY || '',
    motApiKey: process.env.MOT_HISTORY_API_KEY || '',
    motClientId: process.env.MOT_CLIENT_ID || '',
    motClientSecret: process.env.MOT_CLIENT_SECRET || '',
    motTokenUrl: process.env.MOT_TOKEN_URL || '',
    motScope: process.env.MOT_SCOPE || DEFAULT_MOT_SCOPE,
    motLookupUrl: process.env.MOT_LOOKUP_URL || DEFAULT_MOT_LOOKUP_URL,
    requestTimeoutSeconds: Number.parseInt(process.env.REQUEST_TIMEOUT_SECONDS || '20', 10),
  };
}
