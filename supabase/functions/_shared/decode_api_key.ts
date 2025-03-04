function decodeApiKey(apiKey: string) {
  try {
    const jsonString = atob(apiKey);
    const credentials = JSON.parse(jsonString);

    if (!credentials.email || !credentials.password) {
      throw new Error('Invalid Email or Password');
    }

    return credentials;
  } catch (_error) {
    throw new Error('API Decode Error');
  }
}

export default { decodeApiKey };
