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
  const formatCommand = (cmd: any, isSubcommand = false, parentCmd?: string) => {
    const cmdName = cmd.name
    const cmdNameCapitalized = cmdName.charAt(0).toUpperCase() + cmdName.slice(1)

    // Create anchor for TOC linking
    const anchor = isSubcommand ? `${parentCmd}-${cmdName}` : cmdName
    const heading = isSubcommand ? `####` : `###`

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

    section += `${heading} <a id="${anchor}"></a> ${emoji} **${cmdNameCapitalized}**\n\n`

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
    descLines.forEach((line: string) => {
      if (line.trim().startsWith('Note:')) {
        // Format notes with emoji
        section += `> ℹ️ ${line.trim().substring(5).trim()}\n\n`
      }
      else if (line.includes('Example:')) {
        // Skip example lines, they'll be handled separately
      }
      else {
        section += `${line}\n`
      }
    })
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
      section += `**Options:**\n\n`
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

      // Generate frontmatter and content for the command
      let cmdFile = `---
title: ${cmd.name}
sidebar_label: ${cmd.name}
sidebar:
  order: ${commands.indexOf(cmd) + 1}
---

`
      // Add command description with emoji preserved
      const description = cmd.description.split('\n')[0]
      cmdFile += `# ${cmd.name.charAt(0).toUpperCase() + cmd.name.slice(1)}\n\n`
      cmdFile += `${description}\n\n`

      // Add command documentation
      let cmdMarkdown = formatCommand(cmd)

      if (cmd.subcommands.length > 0) {
        cmdMarkdown += `## ${cmd.name.toUpperCase()} Subcommands\n\n`
        cmd.subcommands.forEach((subCmd: any) => {
          cmdMarkdown += formatCommand(subCmd, true, cmd.name)
        })
      }

      cmdFile += cmdMarkdown

      // Write the file
      try {
        writeFileSync(`${folderPath}/${cmd.name}.md`, cmdFile, 'utf8')
        log.success(`Generated documentation file for ${cmd.name} command in ${folderPath}/${cmd.name}.md`)
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
