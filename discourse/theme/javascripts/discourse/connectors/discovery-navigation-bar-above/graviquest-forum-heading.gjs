import Component from "@glimmer/component";
export default class GraviQuestForumHeading extends Component {
  get questionURL() { return `/t/${Number(settings.open_question_topic_id)}`; }
  <template>
    <section class="gq-forum-heading">
      <span class="gq-chapter">Community · Forum</span><h1>The Forum</h1>
      <p>Every Topic has a room. Read any thread without an account; sign in to reply, like or start one.</p>
      {{#if settings.open_question_topic_id}}
        <div class="gq-pinned-question"><div><h2>This Week’s Question</h2>
          <p>A model predicts a material’s behaviour correctly, repeatedly, and nobody, including its authors, can say why. Has science been done?</p></div>
          <a class="btn btn-default" href={{this.questionURL}}>Join the Thread</a>
        </div>
      {{/if}}
    </section>
  </template>
}
