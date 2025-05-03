import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

let cachedClient = null;

export async function getCalendarClient() {
  if (cachedClient) return cachedClient;

  const credentials = JSON.parse(process.env.GOOGLE_CLIENT_SECRET_JSON);

  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
  });

  cachedClient = google.calendar({ version: 'v3', auth: client });
  return cachedClient;
}
