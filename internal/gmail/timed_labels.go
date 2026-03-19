package gmail

import (
	"context"
	"log"
	"time"
)

// TimedLabel defines a label with a name and max age for expiration
type TimedLabel struct {
	Name   string
	MaxAge string // duration key used in timedLabelCutoff
}

// TimedArchiveLabels are labels that trigger archiving after a delay
var TimedArchiveLabels = []TimedLabel{
	{"📥/1d", "1d"},
	{"📥/1w", "7d"},
	{"📥/1m", "30d"},
	{"📥/1y", "365d"},
}

// TimedDeleteLabels are labels that trigger deletion after a delay
var TimedDeleteLabels = []TimedLabel{
	{"🗑️/1d", "1d"},
	{"🗑️/1w", "7d"},
	{"🗑️/1m", "30d"},
	{"🗑️/1y", "365d"},
}

// ArchiveAfterReadLabel is applied to emails that should be archived once the user reads them.
const ArchiveAfterReadLabel = "📥/read"

// ProcessTimedLabels searches for emails with expired timed labels and archives/trashes them.
// Also processes the archive-after-read label.
func (c *Client) ProcessTimedLabels(ctx context.Context) error {
	// Process archive labels
	for _, tl := range TimedArchiveLabels {
		if err := c.processTimedLabel(ctx, tl.Name, tl.MaxAge, false); err != nil {
			log.Printf("Error processing timed archive label %s: %v", tl.Name, err)
			continue
		}
	}

	// Process delete labels
	for _, tl := range TimedDeleteLabels {
		if err := c.processTimedLabel(ctx, tl.Name, tl.MaxAge, true); err != nil {
			log.Printf("Error processing timed delete label %s: %v", tl.Name, err)
			continue
		}
	}

	// Process archive-after-read
	if err := c.processArchiveAfterRead(ctx); err != nil {
		log.Printf("Error processing archive-after-read label: %v", err)
	}

	return nil
}

func (c *Client) processArchiveAfterRead(ctx context.Context) error {
	labelID, err := c.GetLabelID(ctx, ArchiveAfterReadLabel)
	if err != nil {
		return nil // Label doesn't exist yet
	}

	// List messages with this label that are NOT unread (i.e., have been read)
	// Gmail: messages with the label but without the UNREAD label
	msgs, err := c.service.Users.Messages.List(c.userID).
		LabelIds(labelID).
		Q("-is:unread").
		Context(ctx).
		Do()
	if err != nil {
		return err
	}

	if msgs.Messages == nil {
		return nil
	}

	for _, msg := range msgs.Messages {
		// Remove the label and archive
		if err := c.RemoveLabels(ctx, msg.Id, []string{labelID}); err != nil {
			continue
		}
		if err := c.ArchiveMessage(ctx, msg.Id); err != nil {
			continue
		}
		log.Printf("Archived read message %s (📥/read)", msg.Id)
	}

	return nil
}

func (c *Client) processTimedLabel(ctx context.Context, labelName string, maxAge string, trash bool) error {
	labelID, err := c.GetLabelID(ctx, labelName)
	if err != nil {
		return nil // Label doesn't exist yet, nothing to process
	}

	// List messages with this label
	msgs, err := c.service.Users.Messages.List(c.userID).
		LabelIds(labelID).
		Context(ctx).
		Do()
	if err != nil {
		return err
	}

	if msgs.Messages == nil {
		return nil
	}

	// Calculate the cutoff timestamp based on maxAge
	cutoff := timedLabelCutoff(maxAge)

	for _, msg := range msgs.Messages {
		// Get message to check date
		full, err := c.service.Users.Messages.Get(c.userID, msg.Id).
			Format("minimal").
			Context(ctx).
			Do()
		if err != nil {
			continue
		}

		// InternalDate is milliseconds since epoch
		if full.InternalDate < cutoff {
			// Remove the timed label
			if err := c.RemoveLabels(ctx, msg.Id, []string{labelID}); err != nil {
				continue
			}

			if trash {
				if err := c.TrashMessage(ctx, msg.Id); err != nil {
					continue
				}
				log.Printf("Trashed message %s (timed label %s expired)", msg.Id, labelName)
			} else {
				if err := c.ArchiveMessage(ctx, msg.Id); err != nil {
					continue
				}
				log.Printf("Archived message %s (timed label %s expired)", msg.Id, labelName)
			}
		}
	}

	return nil
}

func timedLabelCutoff(maxAge string) int64 {
	now := time.Now()
	switch maxAge {
	case "1d":
		return now.Add(-24 * time.Hour).UnixMilli()
	case "7d":
		return now.Add(-7 * 24 * time.Hour).UnixMilli()
	case "30d":
		return now.Add(-30 * 24 * time.Hour).UnixMilli()
	case "365d":
		return now.Add(-365 * 24 * time.Hour).UnixMilli()
	default:
		return now.UnixMilli()
	}
}
