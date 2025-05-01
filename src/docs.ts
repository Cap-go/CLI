import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { log } from '@clack/prompts'
import { program } from 'commander'

export function generateDocs(filePath: string = './README.md', folderPath?: string) {
  const commands = program.commands.map((cmd: any) => ({
    name: cmd.name(),
    alias: cmd.alias() || '',
    description: cmd.description(),
    options: cmd.options.map((opt: any) => ({
      flags: opt.flags,
      description: opt.description,
    })),
    subcommands: cmd.commands
      ? cmd.commands.map((subCmd: any) => ({
          name: subCmd.name(),
          alias: subCmd.alias() || '',
          description: subCmd.description(),
          options: subCmd.options.map((opt: any) => ({
            flags: opt.flags,
            description: opt.description,
          })),
        }))
      : [],
  }))

  // Function to format command documentation
  const formatCommand = (cmd: any, isSubcommand = false, parentCmd?: string, skipMainHeading = false) => {
    const cmdName = cmd.name
    const cmdNameCapitalized = cmdName.charAt(0).toUpperCase() + cmdName.slice(1)

    // Create anchor for TOC linking - use different IDs for README vs individual files
    let anchor
    if (isSubcommand) {
      // For subcommands, in README we use parent-child format, in individual files just child
      anchor = parentCmd ? `${parentCmd}-${cmdName}` : cmdName
    }
    else {
      // For main commands, in README we use command name, in individual files we use 'options'
      anchor = skipMainHeading ? 'options' : cmdName
    }

    const heading = isSubcommand ? `###` : `##`

    let section = ''

    // Command heading with emoji based on command type
    let emoji = '🔹'
    if (cmdName.includes('upload'))
      emoji = '⬆️'
    else if (cmdName.includes('delete'))
      emoji = '🗑️'
    else if (cmdName.includes('list'))
      emoji = '📋'
    else if (cmdName.includes('add'))
      emoji = '➕'
    else if (cmdName.includes('set'))
      emoji = '⚙️'
    else if (cmdName.includes('create'))
      emoji = '🔨'
    else if (cmdName.includes('encrypt'))
      emoji = '🔒'
    else if (cmdName.includes('decrypt'))
      emoji = '🔓'
    else if (cmdName.includes('debug'))
      emoji = '🐞'
    else if (cmdName.includes('doctor'))
      emoji = '👨‍⚕️'
    else if (cmdName.includes('login'))
      emoji = '🔑'
    else if (cmdName.includes('init'))
      emoji = '🚀'
    else if (cmdName.includes('compatibility'))
      emoji = '🧪'
    else if (cmdName.includes('cleanup'))
      emoji = '🧹'
    else if (cmdName.includes('currentBundle'))
      emoji = '📦'
    else if (cmdName.includes('setting'))
      emoji = '⚙️'
    else if (cmdName === 'app')
      emoji = '📱'
    else if (cmdName === 'bundle')
      emoji = '📦'
    else if (cmdName === 'channel')
      emoji = '📢'
    else if (cmdName === 'key')
      emoji = '🔐'
    else if (cmdName === 'account')
      emoji = '👤'

    // Add the heading unless we're skipping the main heading
    if (!(skipMainHeading && !isSubcommand)) {
      section += `${heading} <a id="${anchor}"></a> ${emoji} **${cmdNameCapitalized}**\n\n`
    }

    if (cmd.alias) {
      section += `**Alias:** \`${cmd.alias}\`\n\n`
    }

    section += `\`\`\`bash\n`
    if (isSubcommand) {
      section += `npx @capgo/cli@latest ${parentCmd} ${cmdName}\n`
    }
    else {
      section += `npx @capgo/cli@latest ${cmdName}\n`
    }
    section += `\`\`\`\n\n`

    // Description - split by line breaks and handle topics
    const descLines = cmd.description.split('\n')
    // Skip the first line for the main command since we already included it
    const startIndex = (!isSubcommand && skipMainHeading) ? 1 : 0

    for (let i = startIndex; i < descLines.length; i++) {
      const line = descLines[i]
      if (line.trim().startsWith('Note:')) {
        // Format notes with emoji
        section += `> ℹ️ ${line.trim().substring(5).trim()}\n\n`
      }
      else if (line.includes('Example:')) {
        // Skip example lines, they'll be handled separately
      }
      else if (line.trim()) { // Only add non-empty lines
        section += `${line}\n`
      }
    }
    section += '\n'

    // Handle example separately
    const exampleLine = cmd.description.split('\n').find((line: string) => line.includes('Example:'))
    if (exampleLine) {
      section += `**Example:**\n\n`
      section += `\`\`\`bash\n`
      section += `${exampleLine.replace('Example: ', '')}\n`
      section += `\`\`\`\n\n`
    }

    // Options table
    if (cmd.options.length > 0) {
      if (!isSubcommand) {
        // Only add the Options title for the main command
        section += `## <a id="options"></a> Options\n\n`
      }
      else {
        section += `**Options:**\n\n`
      }
      section += `| Param          | Type          | Description          |\n`
      section += `| -------------- | ------------- | -------------------- |\n`
      cmd.options.forEach((opt: any) => {
        const param = opt.flags.split(' ')[0]
        const type = opt.flags.split(' ').length > 1 ? 'string' : 'boolean'
        section += `| **${param}** | <code>${type}</code> | ${opt.description} |\n`
      })
      section += '\n'
    }

    return section
  }

  // If folderPath is provided, generate individual files for each command
  if (folderPath) {
    // Create the directory if it doesn't exist
    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true })
    }

    // Process each command
    commands.forEach((cmd) => {
      if (cmd.name === 'generate-docs')
        return // Skip documenting this command

      // Determine emoji for this command
      let emoji = '🔹'
      if (cmd.name.includes('upload'))
        emoji = '⬆️'
      else if (cmd.name.includes('delete'))
        emoji = '🗑️'
      else if (cmd.name.includes('list'))
        emoji = '📋'
      else if (cmd.name.includes('add'))
        emoji = '➕'
      else if (cmd.name.includes('set'))
        emoji = '⚙️'
      else if (cmd.name.includes('create'))
        emoji = '🔨'
      else if (cmd.name.includes('encrypt'))
        emoji = '🔒'
      else if (cmd.name.includes('decrypt'))
        emoji = '🔓'
      else if (cmd.name.includes('debug'))
        emoji = '🐞'
      else if (cmd.name.includes('doctor'))
        emoji = '👨‍⚕️'
      else if (cmd.name.includes('login'))
        emoji = '🔑'
      else if (cmd.name.includes('init'))
        emoji = '🚀'
      else if (cmd.name.includes('compatibility'))
        emoji = '🧪'
      else if (cmd.name.includes('cleanup'))
        emoji = '🧹'
      else if (cmd.name.includes('currentBundle'))
        emoji = '📦'
      else if (cmd.name.includes('setting'))
        emoji = '⚙️'
      else if (cmd.name === 'app')
        emoji = '📱'
      else if (cmd.name === 'bundle')
        emoji = '📦'
      else if (cmd.name === 'channel')
        emoji = '📢'
      else if (cmd.name === 'key')
        emoji = '🔐'
      else if (cmd.name === 'account')
        emoji = '👤'

      // Generate frontmatter and content for the command
      let cmdFile = `---
title: ${emoji} ${cmd.name}
sidebar_label: ${cmd.name}
sidebar:
  order: ${commands.indexOf(cmd) + 1}
---

`
      // Add command description with emoji preserved, but skip the redundant title
      const description = cmd.description.split('\n')[0]
      cmdFile += `${description}\n\n`

      // Generate Table of Contents for this command
      if (cmd.subcommands.length > 0) {
        cmdFile += `## Table of Contents\n\n`

        // Add link to options if present
        if (cmd.options.length > 0) {
          cmdFile += `- [Options](#options)\n`
        }

        // Add links to all subcommands
        cmd.subcommands.forEach((subCmd: any) => {
          const subCmdNameCapitalized = subCmd.name.charAt(0).toUpperCase() + subCmd.name.slice(1)
          cmdFile += `- [${subCmdNameCapitalized}](#${subCmd.name})\n`
        })
        cmdFile += `\n`
      }

      // Add command documentation
      let cmdMarkdown = formatCommand(cmd, false, cmd.name, true) // Last param to skip the main heading

      if (cmd.subcommands.length > 0) {
        cmdMarkdown += `## ${cmd.name.toUpperCase()} Subcommands\n\n`
        cmd.subcommands.forEach((subCmd: any) => {
          cmdMarkdown += formatCommand(subCmd, true, cmd.name)
        })
      }

      cmdFile += cmdMarkdown

      // Write the file
      try {
        writeFileSync(`${folderPath}/${cmd.name}.mdx`, cmdFile, 'utf8')
        log.success(`Generated documentation file for ${cmd.name} command in ${folderPath}/${cmd.name}.mdx`)
      }
      catch (error) {
        console.error(`Error generating file for ${cmd.name}:`, error)
      }
    })
    log.success(`Documentation files generated in ${folderPath}/`)
  }
  else {
    // Generate combined markdown for README
    let markdown = '## 📑 Capgo CLI Commands\n\n'

    // Generate Table of Contents
    markdown += '## 📋 Table of Contents\n\n'
    commands.forEach((cmd) => {
      if (cmd.name === 'generate-docs')
        return // Skip documenting this command

      markdown += `- [${cmd.name.charAt(0).toUpperCase() + cmd.name.slice(1)}](#${cmd.name})\n`

      if (cmd.subcommands.length > 0) {
        cmd.subcommands.forEach((subCmd: any) => {
          markdown += `  - [${subCmd.name.charAt(0).toUpperCase() + subCmd.name.slice(1)}](#${cmd.name}-${subCmd.name})\n`
        })
      }
    })
    markdown += '\n'

    // Generate documentation for each command
    commands.forEach((cmd) => {
      if (cmd.name === 'generate-docs')
        return // Skip documenting this command

      markdown += formatCommand(cmd)

      if (cmd.subcommands.length > 0) {
        markdown += `#### ${cmd.name.toUpperCase()} Subcommands:\n\n`
        cmd.subcommands.forEach((subCmd: any) => {
          markdown += formatCommand(subCmd, true, cmd.name)
        })
      }
      markdown += '\n'
    })

    // Update README.md or write to the specified file
    const startTag = '<!-- AUTO-GENERATED-DOCS-START -->'
    const endTag = '<!-- AUTO-GENERATED-DOCS-END -->'
    let fileContent = ''
    try {
      fileContent = readFileSync(filePath, 'utf8')
    }
    catch {
      fileContent = ''
    }

    const startIndex = fileContent.indexOf(startTag)
    const endIndex = fileContent.indexOf(endTag, startIndex)

    if (startIndex !== -1 && endIndex !== -1) {
      const before = fileContent.substring(0, startIndex + startTag.length)
      const after = fileContent.substring(endIndex)
      const newContent = `${before}\n${markdown}\n${after}`
      writeFileSync(filePath, newContent, 'utf8')
      log.success(`Documentation updated in ${filePath}`)
    }
    else {
      writeFileSync(filePath, markdown, 'utf8')
      log.success(`Documentation written to ${filePath}`)
    }
  }
}
