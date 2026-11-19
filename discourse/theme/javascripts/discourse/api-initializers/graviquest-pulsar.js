import { apiInitializer } from "discourse/lib/api";
import mountPulsar from "../lib/gq-pulsar";

// Only an ID is handed over. The backend independently reads the anonymous
// public thread and checks its room ACL; no logged-in post DOM or composer
// draft is sent to the model, including while viewing a private message.
export default apiInitializer((api) => {
  window.GRAVITAS_CHAT = {
    endpoint: "/gq-pulsar/ask/",
    publicPage: "/forum.html",
    linkBase: "https://graviquest.com/",
    storageKey: "gchat.public.forum.v1",
  };
  mountPulsar();
  api.onPageChange(() => {
    const match = location.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
    window.GravitasChat.updateContext({ page: "/forum.html", forumTopic: match ? Number(match[1]) : null });
  });
});
