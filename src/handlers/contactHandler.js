const { contacts } = require('../services/database');
const { logger, logUserAction } = require('../utils/logger');
const nebulaService = require('../services/nebula');

class ContactHandler {
  // Handle add contact request
  async handleAddContact(from, phone, parameters) {
    try {
      const { name, address } = parameters;
      
      // Validate address format
      if (!nebulaService.validateAddress(address)) {
        await this.sendMessage(from, 'That address doesn’t look right. Please provide a valid 0x… address.');
        return;
      }
      
      // Check if contact name already exists
      const existingContact = await contacts.findContactByName(phone, name);
      if (existingContact) {
        await this.sendMessage(from, `That contact name already exists. Use a different name or delete the existing one first.`);
        return;
      }
      
      // Check if address already exists
      const existingAddress = await contacts.findContactByAddress(phone, address);
      if (existingAddress) {
        await this.sendMessage(from, `This address is already saved as “${existingAddress.name}”.`);
        return;
      }
      
      // Add contact
      await contacts.addContact(phone, name, address);
      
       await this.sendMessage(from, `Contact added.

Name: ${name}
Address: \`${address}\`

You can now send AVAX to “${name}” without typing the full address.`);
      
      logUserAction(phone, 'contact_added', { name, address });
      
    } catch (error) {
      logger.error('Error adding contact:', error);
      await this.sendMessage(from, `❌ Error adding contact: ${error.message}`);
    }
  }
  
  // Handle list contacts request
  async handleListContacts(from, phone) {
    try {
      const userContacts = await contacts.getAllContacts(phone);
      
      if (userContacts.length === 0) {
        await this.sendMessage(from, `You don’t have any contacts yet.

Tip: Use /addcontact name 0xaddress to save one for easier sending.`);
        return;
      }
      
      let contactsMessage = `Your contacts\n\n`;
      
      for (const contact of userContacts) {
        const addressDisplay = this.formatAddress(contact.address);
        contactsMessage += `${contact.name}\n`;
        contactsMessage += `\`${contact.address}\`\n`;
        contactsMessage += `Added: ${new Date(contact.created_at).toLocaleDateString()}\n\n`;
      }
      
      contactsMessage += `💡 *Usage:* Send "send 1 AVAX to ${userContacts[0].name}" to use contacts!`;
      
      await this.sendMessage(from, contactsMessage);
      
      logUserAction(phone, 'contacts_listed', { count: userContacts.length });
      
    } catch (error) {
      logger.error('Error listing contacts:', error);
      await this.sendMessage(from, `❌ Error listing contacts: ${error.message}`);
    }
  }
  
  // Handle delete contact request
  async handleDeleteContact(from, phone, contactName) {
    try {
      // Check if contact exists
      const contact = await contacts.findContactByName(phone, contactName);
      if (!contact) {
        await this.sendMessage(from, `❌ Contact "${contactName}" not found.`);
        return;
      }
      
      // Delete contact
      await contacts.deleteContact(phone, contactName);
      
      await this.sendMessage(from, `✅ *Contact Deleted*

👤 *Name:* ${contactName}
🏦 *Address:* \`${contact.address}\`

Contact has been removed from your address book.`);
      
      logUserAction(phone, 'contact_deleted', { name: contactName, address: contact.address });
      
    } catch (error) {
      logger.error('Error deleting contact:', error);
      await this.sendMessage(from, `❌ Error deleting contact: ${error.message}`);
    }
  }
  
  // Get contact by name
  async getContactByName(ownerPhone, name) {
    try {
      return await contacts.findContactByName(ownerPhone, name);
    } catch (error) {
      logger.error('Error getting contact by name:', error);
      return null;
    }
  }
  
  // Get contact by address
  async getContactByAddress(ownerPhone, address) {
    try {
      return await contacts.findContactByAddress(ownerPhone, address);
    } catch (error) {
      logger.error('Error getting contact by address:', error);
      return null;
    }
  }
  
  // Get all contacts for a user
  async getAllContacts(ownerPhone) {
    try {
      return await contacts.getAllContacts(ownerPhone);
    } catch (error) {
      logger.error('Error getting all contacts:', error);
      return [];
    }
  }
  
  // Validate contact name
  validateContactName(name) {
    // Contact names should be alphanumeric with spaces, 1-20 characters
    const namePattern = /^[a-zA-Z0-9\s]{1,20}$/;
    return namePattern.test(name);
  }
  
  // Format address for display
  formatAddress(address) {
    try {
      return `${address.slice(0, 6)}...${address.slice(-4)}`;
    } catch (error) {
      return address;
    }
  }
  
  // Get contact help text
  getContactHelpText() {
    return `📋 *Contact Management*

*Add Contact:*
• \`/addcontact name 0xaddress\`
• Example: \`/addcontact John 0x1234...\`

*List Contacts:*
• "contacts" or "list contacts"

*Delete Contact:*
• \`/deletecontact name\`
• Example: \`/deletecontact John\`

*Using Contacts:*
• "send 1 AVAX to John" (instead of full address)
• "transfer 0.5 to John"

💡 *Tip:* Contacts make sending AVAX much easier!`;
  }
  
  // Send message helper (this should be injected from command handler)
  async sendMessage(to, message) {
    // This will be overridden by the command handler
    console.log(`[CONTACT] ${to}: ${message}`);
  }
}

module.exports = new ContactHandler();
