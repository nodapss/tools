/**
 * PatchNoteParser.js
 * 
 * Parses PatchNote.txt with the custom format:
 * \date:YYYY.MM.DD \version:vX.X.XX
 * \Changelog:Content \requester:User \updater:User
 * \Details:Content [\requester:User \updater:User]
 */
class PatchNoteParser {
    /**
     * Parse the full text content of PatchNote.txt
     * @param {string} text 
     * @returns {Array} Array of Version objects
     */
    static parse(text) {
        const lines = text.split(/\r?\n/);
        const versions = [];
        let currentVersion = null;
        let currentChangelog = null;

        lines.forEach(line => {
            line = line.trim();
            if (!line) return;

            if (line.startsWith('\\date:')) {
                // Format: \date:2026.01.07 \version:v1.0.63
                // Using regex to handle potential spacing variations
                const versionMatch = line.match(/\\date:(.*?)\s+\\version:(.*)/);

                if (versionMatch) {
                    currentVersion = {
                        date: versionMatch[1].trim(),
                        version: versionMatch[2].trim(),
                        changelogs: []
                    };
                    versions.push(currentVersion);
                    currentChangelog = null; // Reset changelog for new version
                } else {
                    console.warn(`PatchNoteParser: Could not parse date/version line: ${line}`);
                }
            } else if (line.startsWith('\\Changelog:')) {
                const parsed = this.parseTagLine(line, 'Changelog');

                if (currentVersion) {
                    currentChangelog = {
                        content: parsed.content,
                        requester: parsed.requester,
                        updater: parsed.updater,
                        details: []
                    };
                    currentVersion.changelogs.push(currentChangelog);
                } else {
                    console.warn(`PatchNoteParser: Orphaned Changelog found: ${line}`);
                }
            } else if (line.startsWith('\\Details:')) {
                const parsed = this.parseTagLine(line, 'Details');

                if (currentChangelog) {
                    currentChangelog.details.push({
                        content: parsed.content,
                        requester: parsed.requester,
                        updater: parsed.updater
                    });
                } else {
                    console.warn(`PatchNoteParser: Orphaned Details found: ${line}`);
                }
            }
        });

        return versions;
    }

    /**
     * Extracts content, requester, and updater from a line.
     * @param {string} line 
     * @param {string} tagName "Changelog" or "Details" 
     */
    static parseTagLine(line, tagName) {
        const tagPrefix = `\\${tagName}:`;
        let rawContent = line.substring(line.indexOf(tagPrefix) + tagPrefix.length).trim();

        let requester = null;
        let updater = null;

        // Helper to extract and remove metadata tags
        const extractMetadata = (text, tag) => {
            const regex = new RegExp(`\\\\${tag}:(.*?)(?=\\s*\\\\[a-zA-Z]+:|$)`);
            const match = text.match(regex);
            let value = null;
            if (match) {
                value = match[1].trim();
                // We don't remove it yet because we might have multiple tags interleaved
                // But for robust extraction, let's just extract all first.
            }
            return value;
        };

        requester = extractMetadata(rawContent, 'requester');
        updater = extractMetadata(rawContent, 'updater');

        // Clean content by removing the tags
        // We replace the tags and their values with empty string
        let content = rawContent
            .replace(/\\requester:(.*?)(?=\s*\\\\[a-zA-Z]+:|$)/g, '')
            .replace(/\\updater:(.*?)(?=\s*\\\\[a-zA-Z]+:|$)/g, '')
            .trim();

        return { content, requester, updater };
    }
}

// Export for module usage if needed, or just global scope for this project context
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PatchNoteParser;
} else {
    window.PatchNoteParser = PatchNoteParser;
}
