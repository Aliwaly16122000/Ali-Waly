import { api } from './api';

/** Opens (or creates) a direct conversation and returns its id. */
export async function openConversation(userId) {
  const { id } = await api.post('/chat/conversations', { user_id: userId });
  return id;
}
