Purpose: Take the burden out of managing a busy mailbox

- Monitor all new emails into the mailbox
- Each email runs through AI for analysis
- System prompt is configurable in the web UI
- Results of an email analysis are saved to a database - labels added
- Ideally find a way to add notes/meta to an email to suggest actions
- Each Gmail label can have a list of reasons to use that label, configured in the web UI and included with the system prompt
- Each email gets a snake_case_slug (or hash) based on its content, like `marketing_newsletter` or `invoice_due_reminder` so you can identify past actions
- The pipeline for each email is as follows:
    1) runs the subject and body through AI to generate the hash, along with an array of keywords and a single line summary for the email, given past slugs used from that email address to assist with reuse
    2) runs the slug and categories through a second AI to generate the actions to take including: labels to be applied, whether to bypass he inbox, more TBD
    3) save everything to a database row for later, use the ID of the email as the PK so other actions in Gmail can be tracked back
 
In order to keep improving automatically:
- At 8AM and 5PM provide a wrap up of all the emails processed since the last wrap up
- At 5PM daily review all the decisions made in the pipeline and decide what was good and what was not so good and make a memory
- At 6PM Saturday review all the memories made in the last week and consolidate them into a single memory
- At 7PM on the first day of the month review all the weekly memories made in the last month and consolidate them into a single monthly memory
- At 8PM on the first day of the year review all the monthly memories made in the last year and consolidate them into a single yearly memory

- FUTURE: provide a weekly journal of the past week
- FUTURE: allow human to thumbs up/down actions to help guide good decisions
- FUTURE: listen to label changes from a human and use these to guide good decisions
- FUTURE: give a breakdown of how you want the wrap up (headings) so that emails can be categorized in the wrap up and not just a list of emails

Technical details
- Use golang for a small memory footprint
- Web UI using HTMLX to avoid complex front end builds
- OAuth with Google (will need a client ID and secret)
- Use OpenAI nano models for cost saving. v5 is the latest version.
