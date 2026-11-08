import { apiInitializer } from "discourse/lib/api";
import Navigation from "../components/graviquest/navigation";
import ForumHeading from "../components/graviquest/forum-heading";
import CommunityPanels from "../components/graviquest/community-panels";
import RoomLabel from "../components/graviquest/room-label";

export default apiInitializer((api) => {
  api.renderInOutlet("before-header-panel", Navigation);
  api.renderInOutlet("discovery-navigation-bar-above", ForumHeading);
  api.renderInOutlet("after-topic-list", CommunityPanels);
  api.renderInOutlet("topic-list-before-link", RoomLabel);
});
