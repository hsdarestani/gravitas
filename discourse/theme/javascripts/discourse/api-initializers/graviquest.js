import { apiInitializer } from "discourse/lib/api";
import Navigation from "../components/graviquest/navigation";
import ForumHeading from "../components/graviquest/forum-heading";
import CommunityPanels from "../components/graviquest/community-panels";
import RoomLabel from "../components/graviquest/room-label";
import ThemeToggle from "../components/graviquest/theme-toggle";

import { ThreadBreadcrumb, ThreadByline, ThreadRail } from "../components/graviquest/thread-details";

export default apiInitializer((api) => {
  api.renderInOutlet("before-header-panel", Navigation);
  api.headerIcons.add("gq-theme", ThemeToggle, { before: "hamburger" });
  api.renderInOutlet("discovery-navigation-bar-above", ForumHeading);
  api.renderInOutlet("after-topic-list", CommunityPanels);
  api.renderInOutlet("topic-list-before-link", RoomLabel);
  api.renderInOutlet("topic-above-post-stream", ThreadBreadcrumb);
  api.renderInOutlet("topic-title", ThreadByline);
  api.renderInOutlet("topic-navigation", ThreadRail);

  // Each room's "About the … category" thread is its description, created by
  // Discourse with the room. In the lists they were ten identical rows. The
  // class lets common.scss drop them from every topic list; the thread itself
  // still opens from the room.
  api.registerValueTransformer("topic-list-item-class", ({ value, context }) => {
    // Readers' category data has no topic_id, only the description thread's
    // topic_url ("/t/about-the-…-category/9").
    const topic = context?.topic;
    const url = topic?.category?.topic_url;
    if (topic?.id && url && url.split("/").pop() === String(topic.id)) {
      value.push("gq-room-about");
    }
    return value;
  });

  // Below 905px the header hides the site's sections and Workspace, and the
  // menu never offered them, so a phone had no way back to graviquest.com
  // except the logo. They are a menu section of their own; on a wide screen
  // CSS hides it, since the header already shows them.
  const siteLinks = [
    ["topics", "Topics", "https://graviquest.com/topics.html"],
    ["lab", "Lab", "https://graviquest.com/lab.html"],
    ["learn", "Learn", "https://graviquest.com/learn.html"],
    ["community", "Community", "https://graviquest.com/community"],
    ["workspace", "Workspace", "https://graviquest.com/workspace"],
  ];
  api.addSidebarSection((BaseCustomSidebarSection, BaseCustomSidebarSectionLink) => {
    const links = siteLinks.map(
      ([name, text, href]) =>
        new (class extends BaseCustomSidebarSectionLink {
          name = `gq-${name}`;
          href = href;
          title = text;
          text = text;
        })()
    );
    return class extends BaseCustomSidebarSection {
      name = "graviquest";
      title = "GraviQuest";
      text = "GraviQuest";
      links = links;
    };
  });
});
