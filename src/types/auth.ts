/** GET /v1/me response from verified JWT claims. */
export type MeResponse = {
  id: string;
  email: string;
};
